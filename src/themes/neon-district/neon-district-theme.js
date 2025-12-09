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

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets - Fixed bloom levels (was WAY too high!)
const QUALITY_PRESETS = {
    Extreme: {
        buildingCount: 40,
        rainParticles: 5000,
        bloomStrength: 0.4,    // WAS 1.5 - Reduced to prevent whiteout
        bloomRadius: 0.6,
        bloomThreshold: 0.75,
        enablePostProcessing: true,
        flyingVehicles: 5,
    },
    Ultra: {
        buildingCount: 35,
        rainParticles: 4000,
        bloomStrength: 0.4, // WAS 1.4
        bloomRadius: 0.5,
        bloomThreshold: 0.75, // Only very bright things bloom
        enablePostProcessing: true,
        flyingVehicles: 4,
    },
    High: {
        buildingCount: 30,
        rainParticles: 3000,
        bloomStrength: 0.4, // WAS 1.2
        bloomRadius: 0.5,
        bloomThreshold: 0.75,
        enablePostProcessing: true,
        flyingVehicles: 3,
    },
    Medium: {
        buildingCount: 25,
        rainParticles: 2000,
        bloomStrength: 0.35, // WAS 1.0
        bloomRadius: 0.4,
        bloomThreshold: 0.8,
        enablePostProcessing: true,
        flyingVehicles: 2,
    },
    Low: {
        buildingCount: 18,
        rainParticles: 1000,
        bloomStrength: 0.3, // WAS 0.8
        bloomRadius: 0.3,
        bloomThreshold: 0.85,
        enablePostProcessing: false,
        flyingVehicles: 1,
    },
    Minimal: {
        buildingCount: 12,
        rainParticles: 500,
        bloomStrength: 0.5,
        bloomRadius: 0.2,
        bloomThreshold: 0.8,
        enablePostProcessing: false,
        flyingVehicles: 0,
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

    async createScene() {
        console.log('[NeonDistrict] Creating cyberpunk cityscape...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('neon-district-theme');
        if (!container) {
            console.error('[NeonDistrict] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createSkybox();
        this.setupMaterials(); // Initialize shared materials before use
        this.createBuildings();
        this.createStreet();
        this.createStreetLanterns();
        this.createNeonSigns();
        this.createOverheadWires();
        this.createRain();
        this.createFlyingVehicles();
        this.setupLighting();
        this.setupPostProcessing();
        this.updateGroundReflections(); // Pass neon data to ground shader
        this.setupEventListeners();
        this.startAnimation();

        console.log('[NeonDistrict] Scene created');
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

        // SYNTHCITY FOG - Deep purple atmospheric fog
        this.scene.fog = new THREE.Fog(0x1a0a2e, 0, 2500);

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

    createBuildings() {
        const buildingCount = this.qualityPreset.buildingCount;
        const streetWidth = 180;  // Width of the alley corridor
        const buildingSpacing = 120;  // Space between buildings along the street

        // Calculate buildings per side
        const buildingsPerSide = Math.floor(buildingCount / 2);
        const alleyLength = buildingsPerSide * buildingSpacing;

        // CREATE ORGANIZED ALLEY LAYOUT
        // Left side buildings
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100;  // Starts in front of camera
            const xPos = -(streetWidth / 2 + 50 + Math.random() * 30);  // Left side with slight variation

            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;  // Very tall for alley effect

            this.createBuilding(xPos, zPos, width, height, depth);
        }

        // Right side buildings
        for (let i = 0; i < buildingsPerSide; i++) {
            const zPos = -i * buildingSpacing - 100 - buildingSpacing / 2;  // Offset from left side
            const xPos = streetWidth / 2 + 50 + Math.random() * 30;  // Right side with slight variation

            const width = 70 + Math.random() * 80;
            const depth = 70 + Math.random() * 80;
            const height = 500 + Math.random() * 1000;

            this.createBuilding(xPos, zPos, width, height, depth);
        }

        // Add some background buildings for depth
        for (let i = 0; i < 6; i++) {
            const zPos = -alleyLength - 200 - Math.random() * 500;
            const xPos = (Math.random() - 0.5) * 800;
            const width = 100 + Math.random() * 150;
            const depth = 100 + Math.random() * 150;
            const height = 800 + Math.random() * 1500;

            this.createBuilding(xPos, zPos, width, height, depth);
        }

        console.log(`[NeonDistrict] Created alley with ${buildingCount} buildings`);
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

        this.buildings.push(building);
        this.scene.add(building);
    }

    createStorefront(building, width, depth) {
        const height = 24; // Standard ground floor height
        const geometry = new THREE.BoxGeometry(width + 2, height, depth + 2);

        // Random shop color
        const hue = Math.random();
        const color = new THREE.Color().setHSL(hue, 1.0, 0.6);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: color },
                uTime: { value: 0 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying vec2 vUv;
                
                void main() {
                    // Vertical strips (glass doors/windows)
                    float strip = step(0.1, fract(vUv.x * 4.0)); // 4 windows per side
                    
                    // Bottom glow (interior light)
                    float glow = smoothstep(0.0, 0.5, vUv.y);
                    
                    vec3 finalColor = uColor * strip * glow * 2.0;
                    
                    // Add "frame"
                    if (vUv.y > 0.9) finalColor = vec3(0.1); // Top lintel
                    if (vUv.y < 0.1) finalColor = vec3(0.1); // Bottom sill
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = height / 2;
        building.add(mesh);
    }

    createComplexTower(building, width, height, depth) {
        // "SynthCity" Style: Stacked, offset blocks logic
        const levels = Math.floor(3 + Math.random() * 3); // 3 to 5 levels
        let currentY = 0;

        // Base block
        const baseH = height * (0.3 + Math.random() * 0.2);
        const baseGeom = new THREE.BoxGeometry(width, baseH, depth);

        const baseMat = this.buildingMaterial.clone();
        baseMat.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
        baseMat.uniforms.uSeed.value = Math.random();

        const baseMesh = new THREE.Mesh(baseGeom, baseMat);
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
            const mat = this.buildingMaterial.clone();
            mat.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
            mat.uniforms.uSeed.value = Math.random();
            mat.uniforms.uWindowScale.value = 0.5 + Math.random() * 0.5; // Varied windows

            const mesh = new THREE.Mesh(geom, mat);

            // Offset (Cantilever effect)
            // But keep center of mass somewhat stable so they don't look impossible
            const offsetX = (Math.random() - 0.5) * (width - currentW) * 0.8;
            const offsetZ = (Math.random() - 0.5) * (depth - currentD) * 0.8;

            mesh.position.set(offsetX, currentY + blockH / 2, offsetZ);
            building.add(mesh);

            currentY += blockH;

            // Chance for "Bridge" or lateral extrusion? 
            // Maybe too complex for now. Stick to stacking.
        }

        this.createRooftopDetails(building, currentW, height, currentD);
    }

    createStandardTower(building, width, height, depth) {
        // Per-building random seed for variety
        const seed = Math.random() * 1000;
        const glowIntensity = 0.3 + Math.random() * 0.4;
        const windowScale = 0.8 + Math.random() * 0.5;

        // Standard rectangular tower
        const bodyGeometry = new THREE.BoxGeometry(width, height, depth);
        const bodyMaterial = this.buildingMaterial.clone();
        bodyMaterial.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
        bodyMaterial.uniforms.uBuildingHeight.value = height;
        bodyMaterial.uniforms.uBuildingWidth.value = width;
        bodyMaterial.uniforms.uSeed.value = seed;
        bodyMaterial.uniforms.uGlowIntensity.value = glowIntensity;
        bodyMaterial.uniforms.uWindowScale.value = windowScale;
        bodyMaterial.uniforms.uWindowColor.value = new THREE.Color(this.getRandomWindowColor());

        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = height / 2;
        body.userData.material = bodyMaterial; // Store for animation
        building.add(body);

        // Rooftop details (simplified)
        this.createRooftopDetails(building, width, height, depth);

        // Random chance for step-back design
        if (height > 900 && Math.random() > 0.6) {
            const stepHeight = height * 0.25;
            const stepGeometry = new THREE.BoxGeometry(width * 0.6, stepHeight, depth * 0.6);
            const stepMaterial = bodyMaterial.clone();
            const step = new THREE.Mesh(stepGeometry, stepMaterial);
            step.position.y = height + stepHeight / 2;
            building.add(step);
        }
        // Note: building is added to scene in createBuilding()
    }

    createSteppedBuilding(building, width, height, depth) {
        // Building with stepped setbacks (pyramid-like)
        const levels = 3;
        const levelHeight = height / levels;

        for (let i = 0; i < levels; i++) {
            const scale = 1 - (i * 0.2);  // Each level smaller
            const h = levelHeight;
            const geometry = new THREE.BoxGeometry(width * scale, h, depth * scale);

            // Use SHADER material with unique seed
            const material = this.buildingMaterial.clone();
            material.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
            material.uniforms.uSeed.value = Math.random();
            material.uniforms.uWindowScale.value = 0.8 + Math.random() * 0.4;
            material.uniforms.uGlowIntensity.value = 1.6; // Slightly brighter tops

            const level = new THREE.Mesh(geometry, material);
            level.position.y = (i * h) + h / 2;
            building.add(level);
        }
        this.createRooftopDetails(building, width * 0.6, height, depth * 0.6);
    }

    createSpireBuilding(building, width, height, depth) {
        // Building with antenna/spire on top
        const bodyGeometry = new THREE.BoxGeometry(width, height * 0.8, depth);

        // Use SHADER material
        const bodyMaterial = this.buildingMaterial.clone();
        bodyMaterial.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
        bodyMaterial.uniforms.uSeed.value = Math.random();

        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.position.y = height * 0.4;
        building.add(body);

        // Spire/antenna on top
        const spireGeometry = new THREE.CylinderGeometry(2, 5, height * 0.4, 8);
        const spireMaterial = new THREE.MeshStandardMaterial({
            color: 0x333344,
            roughness: 0.3,
            metalness: 0.8,
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
        // Building with wide base that narrows
        const baseGeometry = new THREE.BoxGeometry(width * 1.3, height * 0.3, depth * 1.3);

        // Use SHADER material
        const baseMaterial = this.buildingMaterial.clone();
        baseMaterial.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
        baseMaterial.uniforms.uSeed.value = Math.random();

        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.y = height * 0.15;
        building.add(base);

        // Upper tower
        const towerGeometry = new THREE.BoxGeometry(width * 0.7, height * 0.7, depth * 0.7);
        const towerMaterial = this.buildingMaterial.clone();
        towerMaterial.uniforms = THREE.UniformsUtils.clone(this.buildingMaterial.uniforms);
        towerMaterial.uniforms.uSeed.value = Math.random();

        const tower = new THREE.Mesh(towerGeometry, towerMaterial);
        tower.position.y = height * 0.3 + height * 0.35;
        building.add(tower);

        this.createRooftopDetails(building, width * 0.7, height, depth * 0.7);
    }

    // No longer needed - windows are now procedural in shader
    createWindowStrips() {
        // Removed - using shader-based windows now
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
        // Antenna
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
        // HIGH QUALITY WET ASPHALT - matching rain puddle reference
        const groundGeometry = new THREE.PlaneGeometry(2000, 2000, 1, 1);

        const wetAsphaltMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                uCameraPos: { value: new THREE.Vector3() },
                // Create filled arrays to prevent initializing with empty []
                uLightPositions: { value: new Array(8).fill(0).map(() => new THREE.Vector3(0, 1000, 0)) },
                uLightColors: { value: new Array(8).fill(0).map(() => new THREE.Color(0x000000)) }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vNormal; // We need world normal
                
                void main() {
                    vUv = uv * 30.0; // Tiling
                    vNormal = normalize(vec3(modelMatrix * vec4(0.0, 1.0, 0.0, 0.0))); // Up
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uCameraPos;
                uniform vec3 uLightPositions[8];
                uniform vec3 uLightColors[8];
                
                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                
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
                
                // Multi-octave noise for detailed texture
                float fbm(vec2 p) {
                    float f = 0.0;
                    f += 0.5000 * noise(p); p *= 2.02;
                    f += 0.2500 * noise(p); p *= 2.03;
                    f += 0.1250 * noise(p); p *= 2.01;
                    f += 0.0625 * noise(p);
                    return f / 0.9375;
                }
                
                // Advanced Rain Ripples (Faraz Style)
                vec3 rainRipple(vec2 uv, float time) {
                    float t = time * 4.0;
                    vec2 p = uv * 10.0; // Grid density
                    vec2 h = floor(p);
                    vec2 f = fract(p) - 0.5;
                    
                    vec2 o = vec2(hash(h), hash(h + vec2(17.0, 31.0))) * 0.5; // Offset within cell
                    float rnd = hash(h + vec2(1.0)); // Random start time
                    
                    float d = length(f - o); // Distance to drop center
                    
                    // Ring animation
                    float rippleTime = fract(t + rnd);
                    float wave = sin(d * 40.0 - rippleTime * 20.0) * smoothstep(0.5, 0.0, d);
                    
                    // Fade in/out based on lifespan
                    float fade = smoothstep(0.0, 0.2, rippleTime) * smoothstep(1.0, 0.8, rippleTime);
                    
                    // Normal perturbation derivative
                    vec2 deriv = vec2(wave) * (f - o) * 5.0 * fade;
                    return vec3(deriv.x, 1.0, deriv.y);
                }
                
                void main() {
                    vec2 uv = vWorldPos.xz * 0.02;
                    
                    // ===== DETAILED ASPHALT TEXTURE =====
                    // Coarse aggregate (large stones)
                    float coarse = fbm(uv * 15.0) * 0.3;
                    // Medium aggregate
                    float medium = fbm(uv * 40.0) * 0.2;
                    // Fine aggregate (sand)
                    float fine = fbm(uv * 120.0) * 0.1;
                    // Tar/bitumen patches
                    float tar = smoothstep(0.55, 0.6, noise(uv * 5.0)) * 0.15;
                    // Cracks
                    float cracks = smoothstep(0.48, 0.52, noise(uv * 3.0)) * 0.1;
                    
                    // Base asphalt color - DARKER to allow emissive to pop
                    vec3 dryAsphalt = vec3(0.02, 0.02, 0.03);
                    dryAsphalt += coarse + medium + fine - tar - cracks;
                    
                    // Purple emissive ground glow
                    vec3 emissiveColor = vec3(0.5, 0.0, 0.8); // Purple glow
                    float emissiveIntensity = 0.25;
                    
                    // ===== WET SURFACE =====
                    // Sharper wetness mask for distinct puddles
                    float rawWet = noise(uv * 4.0 + uTime * 0.05);
                    float wetness = smoothstep(0.45, 0.65, rawWet); // Sharper transition
                    
                    vec3 wetAsphalt = dryAsphalt * 0.2;  // Almost black when wet to reflect perfectly
                    vec3 baseColor = mix(dryAsphalt, wetAsphalt, wetness);
                    
                    // ===== NORMAL CALCULATION =====
                    vec3 normal = vec3(0.0, 1.0, 0.0);
                    
                    // Add Grain Normals for detail
                    float grainNormalStrength = 0.5;
                    normal.x += (fbm(uv * 80.0 + vec2(0.01, 0.0)) - fbm(uv * 80.0 - vec2(0.01, 0.0))) * grainNormalStrength;
                    normal.z += (fbm(uv * 80.0 + vec2(0.0, 0.01)) - fbm(uv * 80.0 - vec2(0.0, 0.01))) * grainNormalStrength;
                    
                    // ===== RAIN RIPPLES (Normal Distortion) =====
                    // Mix 2 layers of ripples for variety
                    vec3 ripple1 = rainRipple(uv, uTime);
                    vec3 ripple2 = rainRipple(uv * 0.7 + 5.0, uTime * 0.8);
                    
                    // Combine ripples
                    vec3 totalRipple = ripple1 + ripple2;
                    
                    // Distort normal ONLY in wet areas
                    // Increased distortion for "Fluid" look
                    normal = normalize(normal + totalRipple * wetness * 1.5); 

                    // ===== REFLECTIONS (Using Perturbed Normal) =====
                    vec3 viewDir = normalize(uCameraPos - vWorldPos);
                    vec3 reflectionColor = vec3(0.0);
                    
                    // Dynamic Analytic Lights (Neon Signs)
                    for(int i = 0; i < 8; i++) {
                        vec3 lightPos = uLightPositions[i];
                        vec3 lightColor = uLightColors[i];
                        
                        // Distance check/Falloff
                        float dist = distance(vWorldPos, lightPos);
                        float atten = 1.0 / (1.0 + dist * 0.01 + dist * dist * 0.0001);
                        
                        // Reflection Vector
                        vec3 lightDir = normalize(lightPos - vWorldPos);
                        vec3 reflectDir = reflect(-lightDir, normal);
                        
                        // Specular (Phong)
                        // Wet asphalt has broad, elongated highlights
                        float specBase = max(dot(reflectDir, -viewDir), 0.0);
                        float spec = pow(specBase, 32.0); // Sharpness
                        
                        // Anisotropic-ish stretch?
                        // Simple trick: boost intensity if aligned
                        
                        reflectionColor += lightColor * spec * atten * 4.0; 
                    }
                    
                    // Add subtle ambient "City Glow" (Purple gradient)
                    float cityGlowMix = smoothstep(-100.0, 100.0, vWorldPos.x);
                    vec3 cityGlow = mix(vec3(0.6, 0.0, 1.0), vec3(1.0, 0.0, 0.8), cityGlowMix);
                    reflectionColor += cityGlow * 0.15;

                    // Oil Slick (Rainbow) - Subtle
                    float oilMix = noise(vUv * 0.5);
                    vec3 rainbow = 0.5 + 0.5 * cos(uTime * 0.5 + vUv.xyx + vec3(0, 2, 4));
                    reflectionColor += rainbow * oilMix * 0.2 * wetness;
                    
                    // Final mix
                    // Wet areas are nearly perfect mirrors (Fresnel varies)
                    float reflectivity = wetness * (0.2 + 0.8 * pow(1.0 - max(0.0, dot(normal, viewDir)), 5.0));
                    vec3 finalColor = mix(baseColor, reflectionColor, reflectivity);
                    
                    // Add SYNTHCITY blue emissive glow
                    finalColor += emissiveColor * emissiveIntensity * (1.0 - reflectivity * 0.5);
                    
                    // Tone mapping
                    finalColor = finalColor / (finalColor + vec3(1.0));
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });

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

        // Add floating street lanterns
        this.createStreetLanterns();

        // Add road markings for detail
        this.createRoadMarkings();

        // Add city glow lights
        this.createCityGlowLights();
    }

    createRoadMarkings() {
        // Center line
        const lineGeometry = new THREE.PlaneGeometry(4, 3000);
        const lineMaterial = new THREE.MeshBasicMaterial({
            color: 0xffcc00,  // Yellow center line
            transparent: true,
            opacity: 0.7,
        });
        const centerLine = new THREE.Mesh(lineGeometry, lineMaterial);
        centerLine.rotation.x = -Math.PI / 2;
        centerLine.position.set(0, 2, -400);
        this.scene.add(centerLine);

        // Side puddles that catch light
        const puddleGeometry = new THREE.CircleGeometry(30, 16);
        const puddleMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a2850,
            roughness: 0.05,
            metalness: 0.95,
            emissive: 0x1a0825,
            emissiveIntensity: 0.6,
        });

        for (let i = 0; i < 8; i++) {
            const puddle = new THREE.Mesh(puddleGeometry, puddleMaterial);
            puddle.rotation.x = -Math.PI / 2;
            puddle.position.set(
                (Math.random() - 0.5) * 400,
                1.5,
                -200 - i * 150
            );
            puddle.scale.set(1 + Math.random(), 1 + Math.random() * 0.5, 1);
            this.scene.add(puddle);
        }
    }

    // Ground-level city glow lights - PURPLE DOMINANT
    createCityGlowLights() {
        // Heavy purple/violet themed ground lights
        const glowPositions = [
            { x: -250, z: -200, color: 0xaa00ff },  // Bright purple
            { x: 280, z: -350, color: 0x8800ff },  // Deep purple
            { x: -180, z: -600, color: 0xff00ff },  // Magenta
            { x: 200, z: -100, color: 0x6600ff },  // Violet
            { x: -300, z: -450, color: 0xcc00ff },  // Light purple
            { x: 320, z: -550, color: 0xff00aa },  // Pink-purple
            { x: -100, z: 100, color: 0x9933ff },  // Medium purple
            { x: 150, z: -700, color: 0x7700ff },  // Deep violet
            { x: -200, z: -400, color: 0xbb00ff },  // Bright violet
            { x: 250, z: -250, color: 0xff66ff },  // Light magenta
            { x: -350, z: -150, color: 0xaa00cc },  // Purple-magenta
            { x: 100, z: -500, color: 0x5500ff },  // Royal purple
        ];

        glowPositions.forEach(({ x, z, color }) => {
            const light = new THREE.PointLight(color, 10, 400);
            light.position.set(x, 15, z);
            light.decay = 2;
            this.scene.add(light);
        });

        console.log('[NeonDistrict] Added purple city glow lights');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Neon Signs and Holographic Ads
    // ─────────────────────────────────────────────────────────────────────────

    createNeonSigns() {
        this.neonSigns = [];

        // Mixed types: Shapes and Vertical Banners - MORE SIGNS!
        this.buildings.forEach((building) => {
            // 80% of buildings have at least one sign
            if (Math.random() > 0.8) return;

            // Add 1-3 signs per building
            const signCount = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < signCount; i++) {
                const type = Math.random();
                if (type < 0.4) {
                    this.createNeonShape(building);
                } else if (type < 0.7) {
                    this.createNeonBanner(building);
                } else {
                    this.createNeonStrip(building); // New type!
                }
            }
        });

        // Many more holographic billboards scattered throughout
        this.createHolographicBillboard(-300, 400, -600);
        this.createHolographicBillboard(350, 350, -400);
        this.createHolographicBillboard(0, 500, -800);
        this.createHolographicBillboard(-200, 300, -200);
        this.createHolographicBillboard(250, 450, -150);
        this.createHolographicBillboard(-350, 380, -350);
        this.createHolographicBillboard(100, 550, -500);
        this.createHolographicBillboard(-150, 420, -700);
        this.createHolographicBillboard(400, 320, -250);
        this.createHolographicBillboard(-400, 480, -450);

        // Add floating neon strips in the air
        this.createFloatingNeonElements();
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
        const texture = this.generateNeonTexture(color);

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff, // Texture provides color
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

    generateNeonTexture(baseColor) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Clear
        ctx.fillStyle = '#000000'; // Transp? No, keep it distinct
        ctx.fillRect(0, 0, 128, 256);

        // Border
        const colorStr = '#' + baseColor.getHexString();
        ctx.strokeStyle = colorStr;
        ctx.lineWidth = 4;
        ctx.strokeRect(4, 4, 120, 248);

        // Text
        const words = ['BAR', 'HOTEL', 'OPEN', 'DATA', 'TECH', 'ZONE', 'LIVE', 'SEX', 'XXX', 'GIRLS', 'BOYS', 'CLUB'];
        const kanjis = ['未来', '技術', '電脳', '日本', '東京', '夜', '酒', '愛', '光', '力'];

        const isKanji = Math.random() > 0.5;
        const text = isKanji ? kanjis[Math.floor(Math.random() * kanjis.length)] : words[Math.floor(Math.random() * words.length)];

        ctx.fillStyle = colorStr;
        ctx.shadowColor = colorStr;
        ctx.shadowBlur = 10;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (isKanji) {
            ctx.font = 'bold 60px Arial';
            // Vertical text for Kanji
            ctx.fillText(text.charAt(0), 64, 80);
            if (text.length > 1) ctx.fillText(text.charAt(1), 64, 160);
        } else {
            // Vertical text for words? Rotate?
            ctx.save();
            ctx.translate(64, 128);
            ctx.rotate(-Math.PI / 2);
            ctx.font = 'bold 40px Arial';
            ctx.fillText(text, 0, 0);
            ctx.restore();
        }

        const texture = new THREE.CanvasTexture(canvas);
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

        // ===== RAIN DROPS using LineSegments for streaks =====
        const rainGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 6); // 2 points per line
        const velocities = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const i6 = i * 6;
            const x = (Math.random() - 0.5) * 600;
            const y = Math.random() * 500;
            const z = (Math.random() - 0.5) * 800 - 200;
            const streakLength = 8 + Math.random() * 12;

            // Start point
            positions[i6] = x;
            positions[i6 + 1] = y;
            positions[i6 + 2] = z;
            // End point (streak below)
            positions[i6 + 3] = x - 0.5;
            positions[i6 + 4] = y - streakLength;
            positions[i6 + 5] = z;

            velocities[i] = 20 + Math.random() * 15;
        }

        rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.rainVelocities = velocities;

        const rainMaterial = new THREE.LineBasicMaterial({
            color: 0xaaddff,
            transparent: true,
            opacity: 0.5,
            linewidth: 1,
        });

        this.rainParticles = new THREE.LineSegments(rainGeometry, rainMaterial);
        this.scene.add(this.rainParticles);

        // ===== SPLASH PARTICLES =====
        const splashCount = Math.floor(particleCount * 0.3);
        const splashGeometry = new THREE.BufferGeometry();
        const splashPositions = new Float32Array(splashCount * 3);
        const splashSizes = new Float32Array(splashCount);
        const splashLifetimes = new Float32Array(splashCount);

        for (let i = 0; i < splashCount; i++) {
            splashPositions[i * 3] = (Math.random() - 0.5) * 300;
            splashPositions[i * 3 + 1] = 0.5;  // At ground level
            splashPositions[i * 3 + 2] = (Math.random() - 0.5) * 500 - 180;
            splashSizes[i] = 0;
            splashLifetimes[i] = Math.random();
        }

        splashGeometry.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
        splashGeometry.setAttribute('size', new THREE.BufferAttribute(splashSizes, 1));

        const splashMaterial = new THREE.PointsMaterial({
            color: 0xccddff,
            size: 1.5,  // SMALLER
            transparent: true,
            opacity: 0.35,  // MORE SUBTLE
            sizeAttenuation: true,
        });

        // ACTIVE: Splash particles for ground impact
        this.splashParticles = new THREE.Points(splashGeometry, splashMaterial);
        this.splashLifetimes = splashLifetimes;
        this.scene.add(this.splashParticles);

        console.log(`[NeonDistrict] Created rain with ${particleCount} drops`);
    }

    updateRain(delta) {
        if (!this.rainParticles) return;

        const positions = this.rainParticles.geometry.attributes.position.array;
        const particleCount = positions.length / 6;

        for (let i = 0; i < particleCount; i++) {
            const i6 = i * 6;
            const fallSpeed = this.rainVelocities[i] * delta * 60 * this.rainIntensity;

            // Move both points of the line segment down
            positions[i6 + 1] -= fallSpeed;
            positions[i6 + 4] -= fallSpeed;

            // Slight wind effect
            const wind = Math.sin(this.time * 2 + i * 0.01) * 0.15;
            positions[i6] += wind;
            positions[i6 + 3] += wind;

            // Reset when below ground
            if (positions[i6 + 4] < 0) {
                const newY = 400 + Math.random() * 200;
                const streakLength = 8 + Math.random() * 12;
                positions[i6 + 1] = newY;
                positions[i6 + 4] = newY - streakLength;
                positions[i6] = (Math.random() - 0.5) * 600;
                positions[i6 + 3] = positions[i6] - 0.5;
                positions[i6 + 2] = (Math.random() - 0.5) * 800 - 200;
                positions[i6 + 5] = positions[i6 + 2];
            }
        }

        this.rainParticles.geometry.attributes.position.needsUpdate = true;

        // Update splash particles
        if (this.splashParticles && this.splashLifetimes) {
            const splashPositions = this.splashParticles.geometry.attributes.position.array;
            const splashSizes = this.splashParticles.geometry.attributes.size.array;
            const splashCount = splashPositions.length / 3;

            for (let i = 0; i < splashCount; i++) {
                this.splashLifetimes[i] += delta * 4.0; // Fast splash

                if (this.splashLifetimes[i] > 1.0) {
                    // Reset splash at new random position
                    this.splashLifetimes[i] = Math.random() * 0.5; // Random start delay

                    splashPositions[i * 3] = (Math.random() - 0.5) * 600;
                    splashPositions[i * 3 + 1] = 0.5; // Ground
                    splashPositions[i * 3 + 2] = (Math.random() - 0.5) * 800 - 200;
                }

                // Animate splash: Pop up and fade out
                const life = this.splashLifetimes[i];
                if (life > 0.0) {
                    // Simple "fountain" arc
                    splashPositions[i * 3 + 1] = 0.5 + Math.sin(life * Math.PI) * 1.5;
                    splashSizes[i] = Math.sin(life * Math.PI) * 1.5; // Grow then shrink
                } else {
                    splashSizes[i] = 0;
                }
            }

            this.splashParticles.geometry.attributes.position.needsUpdate = true;
            this.splashParticles.geometry.attributes.size.needsUpdate = true;
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

            // Assign safe lanes to avoid buildings
            const lane = Math.floor(Math.random() * 3); // 0, 1, 2
            let x, y, z;

            if (lane === 0) {
                // Center Lane (Low Altitude - The "Trench" Run)
                x = (Math.random() - 0.5) * 40; // Tight center
                y = 80 + Math.random() * 100;   // 80 to 180 height
            } else {
                // High Altitude (Above buildings)
                x = (Math.random() - 0.5) * 1000;
                y = 350 + Math.random() * 300;  // 350 to 650 height
            }
            z = (Math.random() - 0.5) * 2000;

            vehicle.position.set(x, y, z);

            // Movement parameters mainly along Z axis
            vehicle.userData.speed = 100 + Math.random() * 100; // Faster
            const dirZ = Math.random() > 0.5 ? 1 : -1;
            vehicle.userData.direction = new THREE.Vector3(0, 0, dirZ); // Pure Z movement init
            vehicle.userData.lane = lane;
            vehicle.userData.wobbleOffset = Math.random() * 100;

            this.flyingVehicles.push(vehicle);
            this.scene.add(vehicle);
        }

        console.log(`[NeonDistrict] Created ${count} flying vehicles`);
    }

    // Cyberpunk Spinner - detailed flying vehicle
    createSpinner() {
        const spinner = new THREE.Group();

        // Main body - wedge shaped
        const bodyGeometry = new THREE.BoxGeometry(8, 4, 20);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: 0x222233,
            roughness: 0.4,
            metalness: 0.7,
            emissive: 0x111122,
            emissiveIntensity: 0.2,
        });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        spinner.add(body);

        // Cockpit canopy
        const canopyGeometry = new THREE.SphereGeometry(3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        const canopyMaterial = new THREE.MeshStandardMaterial({
            color: 0x4488ff,
            roughness: 0.1,
            metalness: 0.9,
            transparent: true,
            opacity: 0.7,
        });
        const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
        canopy.rotation.x = Math.PI;
        canopy.position.set(0, 2, 3);
        spinner.add(canopy);

        // Engine pods (left and right)
        const engineGeometry = new THREE.CylinderGeometry(2, 1.5, 8, 8);
        const engineMaterial = new THREE.MeshStandardMaterial({
            color: 0x333344,
            roughness: 0.3,
            metalness: 0.8,
        });

        const leftEngine = new THREE.Mesh(engineGeometry, engineMaterial);
        leftEngine.rotation.x = Math.PI / 2;
        leftEngine.position.set(-6, -1, -2);
        spinner.add(leftEngine);

        const rightEngine = new THREE.Mesh(engineGeometry, engineMaterial);
        rightEngine.rotation.x = Math.PI / 2;
        rightEngine.position.set(6, -1, -2);
        spinner.add(rightEngine);

        // Engine glow (exhaust)
        const exhaustGeometry = new THREE.CircleGeometry(1.8, 8);
        const exhaustColor = Math.random() > 0.5 ? 0x00ffff : 0xff6600;
        const exhaustMaterial = new THREE.MeshBasicMaterial({
            color: exhaustColor,
            transparent: true,
            opacity: 0.9,
        });

        const leftExhaust = new THREE.Mesh(exhaustGeometry, exhaustMaterial);
        leftExhaust.position.set(-6, -1, -6);
        spinner.add(leftExhaust);

        const rightExhaust = new THREE.Mesh(exhaustGeometry, exhaustMaterial);
        rightExhaust.position.set(6, -1, -6);
        spinner.add(rightExhaust);

        // Headlights - bright forward lights
        const headlightGeometry = new THREE.CircleGeometry(1, 8);
        const headlightMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 1.0,
        });
        const leftHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
        leftHeadlight.position.set(-3, 0, 10);
        spinner.add(leftHeadlight);

        const rightHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
        rightHeadlight.position.set(3, 0, 10);
        spinner.add(rightHeadlight);

        // Tail lights - red
        const tailMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0033,
            transparent: true,
            opacity: 0.9,
        });
        const leftTail = new THREE.Mesh(headlightGeometry, tailMaterial);
        leftTail.position.set(-3, 0, -10);
        spinner.add(leftTail);

        const rightTail = new THREE.Mesh(headlightGeometry, tailMaterial);
        rightTail.position.set(3, 0, -10);
        spinner.add(rightTail);

        // Navigation lights (blinking in update)
        const navGeometry = new THREE.SphereGeometry(0.5, 6, 6);
        const navMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        spinner.navLight = new THREE.Mesh(navGeometry, navMaterial);
        spinner.navLight.position.set(0, 3, 0);
        spinner.add(spinner.navLight);

        return spinner;
    }

    updateGroundReflections() {
        if (!this.groundMaterial) return;

        // Find 8 closest/brightest signs to the camera/street center
        // For simplicity, just pick 8 random bright signs or closest to 0,0,0
        // Or sort by y height (lower is better for reflection)

        // Filter signs that have a light attached (userData.light)
        const activeSigns = this.neonSigns.filter(s => s.userData.light).slice(0, 8);

        // Sort by Z to ensure we get signs near the start of the alley
        // this.neonSigns.sort((a,b) => b.position.z - a.position.z);
        // Better: pick random sample or distributed

        const positions = [];
        const colors = [];

        for (let i = 0; i < 8; i++) {
            if (i < activeSigns.length) {
                const s = activeSigns[i];
                positions.push(new THREE.Vector3().copy(s.userData.light.position)); // Use light's position
                colors.push(new THREE.Color(s.userData.baseColor || 0xffffff));
            } else {
                // Dummy fillers
                positions.push(new THREE.Vector3(0, 1000, 0));
                colors.push(new THREE.Color(0x000000));
            }
        }

        this.groundMaterial.uniforms.uLightPositions.value = positions;
        this.groundMaterial.uniforms.uLightColors.value = colors;
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
            } else {
                // High Altitude: Free drift
                vehicle.position.x += Math.cos(time * 0.3) * delta * 15;
                vehicle.position.y += Math.sin(time * 0.5) * delta * 10;
            }

            // Loop / Warp (Infinite traffic)
            if (vehicle.position.z > 1500) vehicle.position.z = -1500;
            if (vehicle.position.z < -1500) vehicle.position.z = 1500;
            if (Math.abs(vehicle.position.x) > 1000) vehicle.position.x *= -0.9; // Soft bound for high flyers

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
        // PURPLE-DOMINANT LIGHTING
        // Ambient: Deep purple tint
        const ambientLight = new THREE.AmbientLight(0x1a0a2e, 0.5);
        this.scene.add(ambientLight);

        // Directional (Moon/Neon Glow): Bright Purple
        const dirLight = new THREE.DirectionalLight(0xaa00ff, 0.4);
        dirLight.position.set(-100, 100, -50);
        this.scene.add(dirLight);

        // Second directional for purple fill
        const dirLight2 = new THREE.DirectionalLight(0x6600ff, 0.25);
        dirLight2.position.set(100, 80, 50);
        this.scene.add(dirLight2);

        // Purple-heavy point lights throughout the scene
        const lightPositions = [
            // Deep purple lights
            { pos: [-200, 200, -300], color: 0x8800ff, intensity: 6 },
            { pos: [280, 250, -500], color: 0xaa00ff, intensity: 5 },
            { pos: [100, 80, 100], color: 0x6600ff, intensity: 4 },
            // Magenta/pink lights
            { pos: [-180, 150, 50], color: 0xff00ff, intensity: 6 },
            { pos: [200, 180, -150], color: 0xff00aa, intensity: 5 },
            { pos: [-100, 100, -400], color: 0xcc00ff, intensity: 4 },
            // Violet accents
            { pos: [0, 120, 200], color: 0x9933ff, intensity: 4 },
            { pos: [-250, 300, -200], color: 0x7700ff, intensity: 5 },
            { pos: [300, 280, -350], color: 0xbb00ff, intensity: 4 },
            // Cyan accent (small amount for contrast)
            { pos: [150, 150, -600], color: 0x00ffff, intensity: 3 },
        ];

        lightPositions.forEach(({ pos, color, intensity }) => {
            const light = new THREE.PointLight(color, intensity, 600);
            light.position.set(...pos);
            this.scene.add(light);
        });

        console.log('[NeonDistrict] Purple-dominant lighting configured');
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
        // Piece lock - neon pulse
        const onPieceLock = () => {
            this.lightPulseIntensity = 0.5;
            this.bloomBoost = 0.3;
        };
        eventBus.on(EVENTS.PIECE_LOCKED, onPieceLock);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.PIECE_LOCKED, onPieceLock));

        // Line clear - lightning flash
        const onLineClear = (data) => {
            const lineCount = data?.lines || 1;
            this.lightPulseIntensity = 0.8 + lineCount * 0.2;
            this.bloomBoost = 0.5 + lineCount * 0.1;
            this.rainIntensity = 1.5 + lineCount * 0.3;
        };
        eventBus.on(EVENTS.LINES_CLEARED, onLineClear);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.LINES_CLEARED, onLineClear));

        // Combo - intensify effects
        const onCombo = (data) => {
            const combo = data?.combo || 1;
            this.lightPulseIntensity += combo * 0.15;
            this.bloomBoost += combo * 0.1;
        };
        eventBus.on(EVENTS.COMBO, onCombo);
        this.eventUnsubscribers.push(() => eventBus.off(EVENTS.COMBO, onCombo));

        // Resize handler
        const onResize = () => this.handleResize();
        window.addEventListener('resize', onResize);
        this.eventUnsubscribers.push(() => window.removeEventListener('resize', onResize));
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
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const animId = requestAnimationFrame(animate);
            this.registerAnimation(animId);

            const delta = this.clock.getDelta();
            this.time += delta;

            // Update sky shader
            if (this.sky?.material?.uniforms?.uTime) {
                this.sky.material.uniforms.uTime.value = this.time;
            }

            // Update rain
            this.updateRain(delta);

            // Update flying vehicles
            this.updateFlyingVehicles(delta);

            // Update neon signs (flicker)
            this.updateNeonSigns();

            // Update blinking lights
            this.updateBlinkingLights();

            // Decay effects
            this.lightPulseIntensity *= 0.95;
            this.bloomBoost *= 0.93;
            this.rainIntensity = THREE.MathUtils.lerp(this.rainIntensity, 1.0, delta * 2);

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

    updateNeonSigns() {
        this.neonSigns.forEach((sign) => {
            if (sign.userData.flickerPhase !== undefined) {
                // Simple flicker effect
                const flicker = Math.sin(this.time * sign.userData.flickerSpeed + sign.userData.flickerPhase);
                const flickerAmount = sign.userData.flickerAmount;

                if (sign.material.opacity !== undefined) {
                    sign.material.opacity = 0.7 + flicker * flickerAmount + this.lightPulseIntensity * 0.3;
                }
            }

            // Update holographic billboard shaders
            if (sign.material.uniforms?.uTime) {
                sign.material.uniforms.uTime.value = this.time;
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

        this.flyingVehicles.forEach((vehicle) => {
            vehicle.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        });

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

        this.scene = null;
        this.camera = null;

        super.cleanup();
        console.log('[NeonDistrict] Cleanup complete');
    }
}
