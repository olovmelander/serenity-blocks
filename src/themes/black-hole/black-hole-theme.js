/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ BLACK HOLE ✧
 *  A 3D Space Theme for Serenity Blocks using Three.js
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Raymarched black hole with gravitational lensing
 * - Volumetric accretion disk with Doppler effects
 * - 3D starfield with twinkling
 * - Nebula clouds with procedural textures
 * - GPU particle system for stardust
 * - Post-processing: Bloom, Vignette, Chromatic Aberration
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BLACK_HOLE_TETROMINOS } from './black-hole-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 3000,
        particleCount: 2000,
        nebulaCount: 25,
        diskSegments: 128,
        burstSparkCount: 3000,
        bloomStrength: 0.6,
        bloomRadius: 0.8,
        enablePostProcessing: true,
    },
    Ultra: {
        starCount: 2500,
        particleCount: 1500,
        nebulaCount: 20,
        diskSegments: 96,
        burstSparkCount: 2500,
        bloomStrength: 0.55,
        bloomRadius: 0.7,
        enablePostProcessing: true,
    },
    High: {
        starCount: 2000,
        particleCount: 1000,
        nebulaCount: 15,
        diskSegments: 64,
        burstSparkCount: 2000,
        bloomStrength: 0.5,
        bloomRadius: 0.6,
        enablePostProcessing: true,
    },
    Medium: {
        starCount: 1200,
        particleCount: 600,
        nebulaCount: 10,
        diskSegments: 48,
        burstSparkCount: 1500,
        bloomStrength: 0.4,
        bloomRadius: 0.5,
        enablePostProcessing: true,
    },
    Low: {
        starCount: 600,
        particleCount: 300,
        nebulaCount: 6,
        diskSegments: 32,
        burstSparkCount: 1000,
        bloomStrength: 0.3,
        bloomRadius: 0.4,
        enablePostProcessing: false,
    },
    Minimal: {
        starCount: 300,
        particleCount: 150,
        nebulaCount: 4,
        diskSegments: 24,
        burstSparkCount: 600,
        bloomStrength: 0.2,
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
        darkness: { value: 0.6 },
        offset: { value: 1.2 },
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
            float vig = smoothstep(offset, offset - 0.6, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Chromatic Aberration Shader
// ─────────────────────────────────────────────────────────────────────────────
const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        amount: { value: 0.003 },
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
        uniform float amount;
        varying vec2 vUv;
        
        void main() {
            vec2 dir = vUv - 0.5;
            float dist = length(dir);
            vec2 offset = dir * dist * amount;
            
            float r = texture2D(tDiffuse, vUv + offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - offset).b;
            
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Event Horizon Burst Sparks Shader - Explosive particles from black hole
// ─────────────────────────────────────────────────────────────────────────────
const BurstSparkVertexShader = `
    attribute float aTheta;
    attribute float aPhi;
    attribute float aRandom;
    attribute vec3 aColor;

    uniform float uTime;
    uniform float uPulseTimer;
    uniform vec2 uBlackHolePos;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vColor = aColor;

        // Calculate if this particle should be active
        float stagger = aRandom * 3.0;
        float localTime = uPulseTimer - stagger;

        if (localTime < 0.0 || uPulseTimer < -50.0) {
            // Not yet triggered or inactive
            gl_Position = vec4(0.0, 0.0, -9999.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
        }

        // Explosion parameters
        float maxLife = 45.0;
        float life = clamp(localTime / maxLife, 0.0, 1.0);

        // Burst outward from event horizon
        float startRadius = 120.0; // Event horizon radius
        float maxRadius = 900.0 + aRandom * 500.0;

        // Explosive easing - fast start, slow end
        float easeOut = 1.0 - pow(1.0 - life, 3.0);
        float radius = startRadius + (maxRadius - startRadius) * easeOut;

        // Spherical to cartesian
        float x = radius * sin(aPhi) * cos(aTheta);
        float y = radius * sin(aPhi) * sin(aTheta);
        float z = radius * cos(aPhi);

        // Add spiral motion for dramatic effect
        float spiralAngle = aTheta + life * 3.0 * (aRandom - 0.5);
        x = radius * sin(aPhi) * cos(spiralAngle);
        y = radius * sin(aPhi) * sin(spiralAngle);

        // Offset by black hole position
        vec3 pos = vec3(x + uBlackHolePos.x, y + uBlackHolePos.y, z);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Size - larger at start, shrinking as they fly out
        float baseSize = 5.0 + aRandom * 8.0;
        float sizeLife = 1.0 - life * 0.6;
        gl_PointSize = baseSize * sizeLife * (300.0 / -mvPosition.z);

        // Alpha - fade out over lifetime
        vAlpha = (1.0 - life * life) * (0.9 + aRandom * 0.1);
    }
`;

const BurstSparkFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;

        // Soft glow with hot core
        float glow = 1.0 - dist * 2.0;
        glow = pow(glow, 1.3);

        // Add white-hot center
        vec3 color = vColor;
        float core = smoothstep(0.3, 0.0, dist);
        color = mix(color, vec3(1.0, 1.0, 0.95), core * 0.5);

        gl_FragColor = vec4(color * glow, vAlpha * glow);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Black Hole Core Shader (with gravitational lensing)
// ─────────────────────────────────────────────────────────────────────────────
const BlackHoleShader = {
    uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uScale: { value: 1.0 },
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
        uniform float uIntensity;
        uniform float uScale;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        #define PI 3.14159265359
        
        // Noise functions
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
        
        float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) {
                v += a * noise(p);
                p *= 2.0;
                a *= 0.5;
            }
            return v;
        }
        
        void main() {
            vec2 uv = vUv * 2.0 - 1.0;
            float dist = length(uv);
            
            // Event horizon (absolute black center)
            float eventHorizon = 0.25 * uScale;
            
            // Photon sphere (bright ring)
            float photonSphere = 0.4 * uScale;
            float photonWidth = 0.08;
            
            // Gravitational lensing distortion
            float lensing = 1.0 / (1.0 + exp(-20.0 * (dist - photonSphere)));
            
            // Black hole center
            float black = smoothstep(eventHorizon + 0.02, eventHorizon - 0.02, dist);
            
            // Photon ring glow
            float photonRing = exp(-pow((dist - photonSphere) / photonWidth, 2.0));
            photonRing *= uIntensity;
            
            // Hawking radiation shimmer
            float shimmer = fbm(uv * 8.0 + uTime * 0.5) * 0.3;
            photonRing += shimmer * smoothstep(0.5, 0.3, dist) * (1.0 - black);
            
            // Colors
            vec3 photonColor = mix(
                vec3(1.0, 0.6, 0.2),  // Orange
                vec3(1.0, 1.0, 1.0),  // White
                photonRing
            );
            
            // Add blue tint at edge
            photonColor = mix(photonColor, vec3(0.4, 0.6, 1.0), smoothstep(0.35, 0.5, dist) * 0.3);
            
            // Final color
            vec3 color = photonColor * photonRing * uIntensity;
            float alpha = photonRing * (1.0 - black) + black * 0.95;
            
            // Make center absolutely black
            color = mix(color, vec3(0.0), black);
            
            gl_FragColor = vec4(color, alpha);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Accretion Disk Shader - Toned down for realistic look
// ─────────────────────────────────────────────────────────────────────────────
const AccretionDiskShader = {
    uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uRotationSpeed: { value: 1.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vPosition;
        
        void main() {
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uRotationSpeed;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vPosition;
        
        #define PI 3.14159265359
        
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
        
        float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) {
                v += a * noise(p);
                p *= 2.0;
                a *= 0.5;
            }
            return v;
        }
        
        void main() {
            float angle = atan(vPosition.z, vPosition.x);
            float radius = length(vPosition.xz);
            
            // Normalize radius (inner edge = 0, outer edge = 1)
            float normalizedRadius = (radius - 120.0) / 280.0;
            normalizedRadius = clamp(normalizedRadius, 0.0, 1.0);
            
            // Animated rotation - slower
            float rotatedAngle = angle + uTime * uRotationSpeed * 0.15;
            
            // Turbulent plasma flow
            vec2 turbUv = vec2(rotatedAngle * 2.0, normalizedRadius * 8.0);
            float turb = fbm(turbUv + uTime * 0.1);
            
            // Spiral arms - more subtle
            float spirals = sin(rotatedAngle * 3.0 + normalizedRadius * 15.0 + turb * 3.0);
            spirals = spirals * 0.3 + 0.7;
            
            // Temperature gradient (inner hot, outer cool)
            float temp = 1.0 - pow(normalizedRadius, 0.5);
            
            // Subdued color palette
            vec3 innerColor = vec3(1.0, 0.7, 0.4);   // Yellow-orange
            vec3 midColor = vec3(0.9, 0.4, 0.15);    // Orange
            vec3 outerColor = vec3(0.5, 0.15, 0.08); // Deep red-brown
            
            vec3 baseColor;
            if (temp > 0.5) {
                baseColor = mix(midColor, innerColor, (temp - 0.5) * 2.0);
            } else {
                baseColor = mix(outerColor, midColor, temp * 2.0);
            }
            
            // Subtle turbulence effect
            baseColor *= 0.8 + turb * 0.4;
            
            // Doppler effect - subtle
            float doppler = sin(angle) * 0.15;
            baseColor = mix(baseColor, vec3(0.6, 0.7, 1.0), max(0.0, doppler));
            baseColor = mix(baseColor, vec3(0.9, 0.2, 0.05), max(0.0, -doppler));
            
            // Brightness - much more controlled
            float brightness = 0.4 + spirals * 0.3 + turb * 0.2;
            brightness *= uIntensity * 0.6; // Reduce overall brightness
            
            // Edge fade - stronger fade at center to reveal black hole
            float innerFade = smoothstep(0.0, 0.25, normalizedRadius);
            float outerFade = smoothstep(1.0, 0.7, normalizedRadius);
            float edgeFade = innerFade * outerFade;
            
            // Final color
            vec3 color = baseColor * brightness;
            float alpha = edgeFade * brightness * 0.7;
            
            gl_FragColor = vec4(color, alpha);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class BlackHoleTheme extends BaseTheme {
    constructor() {
        super('black-hole');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.blackHoleCore = null;
        this.accretionDisk = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.particles = null;
        this.jetParticles = null;
        this.burstSparksPool = []; // Pool of burst particle systems for overlapping effects
        this.burstPoolSize = 8; // Maximum simultaneous bursts
        this.nextBurstIndex = 0; // Round-robin index for pool allocation

        // Effect state
        this.diskIntensity = 1.0;
        this.diskTargetIntensity = 1.0;
        this.coreIntensity = 1.0;
        this.coreTargetIntensity = 1.0;
        this.diskRotationSpeed = 1.0;
        this.diskTargetRotationSpeed = 1.0;
        this.starFlashIntensity = 0;
        this.bloomPulseIntensity = 0;
        this.starFlashIntensity = 0;
        this.bloomPulseIntensity = 0;
        this.chromaticPulse = 0;
        this.gravitySurgeFactor = 0; // State for suction effect
        this.burstFactor = 0; // State for outward explosion effect
        this.burstPhase = false; // Track if we're in burst phase

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // Black hole drift (floating motion)
        this.blackHoleGroup = null;
        this.driftX = 0;
        this.driftY = 0;
        this.driftPhaseX = Math.random() * Math.PI * 2;
        this.driftPhaseY = Math.random() * Math.PI * 2;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.resizeHandler = null;

        console.log('[BlackHole] Theme constructed');
    }

    getTetrominoConfig() {
        return BLACK_HOLE_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
    }

    async createScene() {
        console.log('[BlackHole] Creating 3D scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('black-hole-theme');
        if (!container) {
            console.error('[BlackHole] Container not found');
            return;
        }

        // Hide all old CSS-based black hole elements
        this.hideOldDOMElements(container);

        this.initRenderer(container);
        this.createStarfield();
        this.createNebulaClouds();
        this.createBlackHoleCore();
        this.createAccretionDisk();
        this.createParticleSystem();
        this.createBurstSparks();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[BlackHole] Scene created');
    }

    /**
     * Hide old DOM-based black hole elements so Three.js canvas is visible
     */
    hideOldDOMElements(container) {
        // Hide all child divs and canvases that are old CSS elements
        const elementsToHide = [
            '#stellar-background',
            '#stellar-black-hole',
            '#stellar-stars',
            '#stellar-stardust-canvas',
            '#stellar-bursts',
            '#stellar-supernova',
            '.stellar-nebula-cloud',
        ];

        elementsToHide.forEach((selector) => {
            const elements = container.querySelectorAll(selector);
            elements.forEach((el) => {
                el.style.display = 'none';
            });
        });

        console.log('[BlackHole] Hidden old DOM elements');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(0x000005, 1); // Very dark blue-black
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Camera looking at center, slightly above for dramatic angle
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        this.camera.position.set(0, 200, 800);
        this.camera.lookAt(0, 0, 0);

        // Ambient light (very dim)
        const ambientLight = new THREE.AmbientLight(0x202030, 0.3);
        this.scene.add(ambientLight);

        console.log('[BlackHole] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - 3D Points with twinkling
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const phases = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0xffeedd), // Warm white
            new THREE.Color(0xddddff), // Cool white
            new THREE.Color(0xffdddd), // Pink tint
            new THREE.Color(0xaaddff), // Blue tint
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Distribute stars in a large sphere, pushed behind the black hole
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 2000 + Math.random() * 3000;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 2000; // Push back

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1 + Math.random() * 3;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        // Custom shader material for twinkling
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uFlashIntensity: { value: 0 },
            },
            vertexShader: `
                attribute float size;
                attribute float phase;
                varying vec3 vColor;
                varying float vPhase;
                
                void main() {
                    vColor = color;
                    vPhase = phase;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uFlashIntensity;
                varying vec3 vColor;
                varying float vPhase;
                
                void main() {
                    float dist = length(gl_PointCoord - 0.5);
                    if (dist > 0.5) discard;
                    
                    float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + vPhase);
                    float flash = 1.0 + uFlashIntensity;
                    float alpha = (1.0 - dist * 2.0) * twinkle * flash;
                    
                    gl_FragColor = vec4(vColor * flash, alpha);
                }
            `,
            transparent: true,
            vertexColors: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        console.log('[BlackHole] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Billboard planes with procedural textures
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const cloudCount = this.qualityPreset.nebulaCount;

        for (let i = 0; i < cloudCount; i++) {
            const size = 1500 + Math.random() * 2000;

            // Create soft radial gradient texture
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Vibrant cosmic colors
            const colorType = Math.random();
            let hue;
            let sat;
            let light;
            if (colorType < 0.25) {
                hue = 280 + Math.random() * 40; // Purple/Violet
                sat = 80;
                light = 40;
            } else if (colorType < 0.5) {
                hue = 320 + Math.random() * 40; // Magenta/Pink
                sat = 85;
                light = 45;
            } else if (colorType < 0.75) {
                hue = 180 + Math.random() * 40; // Cyan/Teal
                sat = 75;
                light = 40;
            } else {
                hue = 20 + Math.random() * 30; // Orange/Gold
                sat = 80;
                light = 45;
            }

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, 0.25)`);
            gradient.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light}%, 0.12)`);
            gradient.addColorStop(0.7, `hsla(${hue}, ${sat}%, ${light}%, 0.04)`);
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

            // Spread across sky
            cloud.position.x = (Math.random() - 0.5) * 4000;
            cloud.position.y = (Math.random() - 0.5) * 2000;
            cloud.position.z = -1000 - Math.random() * 1500;

            cloud.rotation.z = Math.random() * Math.PI;

            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        }

        console.log('[BlackHole] Nebula clouds created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Black Hole Core - Raymarched sphere with event horizon
    // ─────────────────────────────────────────────────────────────────────────

    createBlackHoleCore() {
        const geometry = new THREE.PlaneGeometry(600, 600);
        const material = new THREE.ShaderMaterial({
            uniforms: { ...BlackHoleShader.uniforms },
            vertexShader: BlackHoleShader.vertexShader,
            fragmentShader: BlackHoleShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.blackHoleCore = new THREE.Mesh(geometry, material);
        this.blackHoleCore.position.set(0, 0, 0);
        this.blackHoleCore.renderOrder = 100;
        this.scene.add(this.blackHoleCore);

        // Inner black sphere (solid event horizon) - LARGER
        const blackGeometry = new THREE.SphereGeometry(120, 48, 48);
        const blackMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: false,
        });
        this.eventHorizonSphere = new THREE.Mesh(blackGeometry, blackMaterial);
        this.eventHorizonSphere.position.set(0, 0, 0);
        this.eventHorizonSphere.renderOrder = 99;
        this.scene.add(this.eventHorizonSphere);

        console.log('[BlackHole] Black hole core created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Accretion Disk - Torus with volumetric shader
    // ─────────────────────────────────────────────────────────────────────────

    createAccretionDisk() {
        const segments = this.qualityPreset.diskSegments;

        // Create a smaller, more refined disk
        const innerRadius = 140;
        const outerRadius = 400;
        const geometry = new THREE.RingGeometry(innerRadius, outerRadius, segments, 6);

        const material = new THREE.ShaderMaterial({
            uniforms: { ...AccretionDiskShader.uniforms },
            vertexShader: AccretionDiskShader.vertexShader,
            fragmentShader: AccretionDiskShader.fragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.NormalBlending, // Changed from Additive for more control
        });

        this.accretionDisk = new THREE.Mesh(geometry, material);
        this.accretionDisk.rotation.x = -Math.PI * 0.42; // Slightly less tilt
        this.accretionDisk.position.set(0, 0, 0);
        this.accretionDisk.renderOrder = 50;
        this.scene.add(this.accretionDisk);

        // Second disk layer - behind with additive for glow
        const glowMaterial = material.clone();
        glowMaterial.blending = THREE.AdditiveBlending;
        glowMaterial.uniforms.uIntensity.value = 0.3;
        const glowDisk = new THREE.Mesh(geometry.clone(), glowMaterial);
        glowDisk.rotation.x = -Math.PI * 0.42;
        glowDisk.scale.set(1.1, 1.1, 1.1);
        glowDisk.renderOrder = 49;
        this.scene.add(glowDisk);
        this.innerDisk = glowDisk;

        console.log('[BlackHole] Accretion disk created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Particle System - Stardust being pulled into black hole
    // ─────────────────────────────────────────────────────────────────────────

    createParticleSystem() {
        const particleCount = this.qualityPreset.particleCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const lifetimes = new Float32Array(particleCount);

        const particleColors = [
            new THREE.Color(0xff66aa), // Pink
            new THREE.Color(0x66aaff), // Cyan
            new THREE.Color(0xffaa66), // Orange
            new THREE.Color(0xaa66ff), // Purple
            new THREE.Color(0x66ffaa), // Green
        ];

        for (let i = 0; i < particleCount; i++) {
            this.initParticle(i, positions, velocities, colors, sizes, lifetimes, particleColors);
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                attribute float size;
                attribute float lifetime;
                varying vec3 vColor;
                varying float vLifetime;
                
                void main() {
                    vColor = color;
                    vLifetime = lifetime;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (200.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vLifetime;
                
                void main() {
                    float dist = length(gl_PointCoord - 0.5);
                    if (dist > 0.5) discard;
                    
                    float alpha = (1.0 - dist * 2.0) * min(1.0, vLifetime);
                    vec3 color = vColor * (1.0 + (1.0 - vLifetime) * 0.5);
                    
                    gl_FragColor = vec4(color, alpha * 0.8);
                }
            `,
            transparent: true,
            vertexColors: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.particles = new THREE.Points(geometry, material);
        this.particleVelocities = velocities;
        this.particleLifetimes = lifetimes;
        this.particleColors = particleColors;
        this.scene.add(this.particles);

        console.log('[BlackHole] Particle system created with', particleCount, 'particles');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Burst Sparks - Explosive shader-driven particles from event horizon
    // ─────────────────────────────────────────────────────────────────────────

    createBurstSparks() {
        const count = this.qualityPreset.burstSparkCount;
        const particlesPerBurst = Math.floor(count / this.burstPoolSize);

        // Color palette - cosmic hot colors
        const colorOptions = [
            new THREE.Color(0xffaa44), // Orange
            new THREE.Color(0xff6622), // Deep orange
            new THREE.Color(0x44aaff), // Cyan blue
            new THREE.Color(0xaa66ff), // Purple
            new THREE.Color(0xffffff), // White hot
            new THREE.Color(0xff44aa), // Pink
        ];

        // Create pool of burst particle systems
        for (let poolIndex = 0; poolIndex < this.burstPoolSize; poolIndex++) {
            const geometry = new THREE.BufferGeometry();

            const thetas = new Float32Array(particlesPerBurst);
            const phis = new Float32Array(particlesPerBurst);
            const randoms = new Float32Array(particlesPerBurst);
            const colors = new Float32Array(particlesPerBurst * 3);
            const positions = new Float32Array(particlesPerBurst * 3);

            for (let i = 0; i < particlesPerBurst; i++) {
                // Distribute particles evenly on sphere surface (event horizon)
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                thetas[i] = theta;
                phis[i] = phi;
                randoms[i] = Math.random();

                // Color selection - weighted toward hot colors
                const colorType = Math.random();
                let c;
                if (colorType > 0.5) c = colorOptions[0]; // 50% orange
                else if (colorType > 0.3) c = colorOptions[1]; // 20% deep orange
                else if (colorType > 0.15) c = colorOptions[2]; // 15% cyan
                else if (colorType > 0.05) c = colorOptions[3]; // 10% purple
                else c = colorOptions[4]; // 5% white hot

                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;

                // Zero initial position (handled entirely by vertex shader)
                positions[i * 3] = 0;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = 0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aTheta', new THREE.BufferAttribute(thetas, 1));
            geometry.setAttribute('aPhi', new THREE.BufferAttribute(phis, 1));
            geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
            geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPulseTimer: { value: -100.0 }, // Inactive by default
                    uBlackHolePos: { value: new THREE.Vector2(0, 0) },
                },
                vertexShader: BurstSparkVertexShader,
                fragmentShader: BurstSparkFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const burstSparks = new THREE.Points(geometry, material);
            this.burstSparksPool.push(burstSparks);
            this.scene.add(burstSparks);
        }

        console.log('[BlackHole] Burst sparks pool created with', this.burstPoolSize, 'systems,', particlesPerBurst, 'particles each');
    }

    initParticle(index, positions, velocities, colors, sizes, lifetimes, colorPalette) {
        const i3 = index * 3;

        // Spawn in a ring around the black hole (tilted to match disk)
        const angle = Math.random() * Math.PI * 2;
        const radius = 400 + Math.random() * 600;
        const height = (Math.random() - 0.5) * 120; // Thicker distribution for organic feel

        // Flat coordinates
        let px = Math.cos(angle) * radius;
        let py = height;
        let pz = Math.sin(angle) * radius;

        // Apply tilt rotation (around X axis) - matches disk rotation
        const tilt = -Math.PI * 0.42;
        const cosT = Math.cos(tilt);
        const sinT = Math.sin(tilt);

        // Rotate position
        const p_y = py * cosT - pz * sinT;
        const p_z = py * sinT + pz * cosT;
        py = p_y;
        pz = p_z;

        positions[i3] = px;
        positions[i3 + 1] = py;
        positions[i3 + 2] = pz;

        // Initial velocity - Orbital motion (increased slightly to maintain orbit without forcing)
        const orbitalSpeed = 0.3 + Math.random() * 0.3;

        // Tangential velocity on flat plane
        let vx = -Math.sin(angle) * orbitalSpeed;
        let vy = (Math.random() - 0.5) * 0.05;
        let vz = Math.cos(angle) * orbitalSpeed;

        // Rotate velocity to match tilted plane
        const v_y = vy * cosT - vz * sinT;
        const v_z = vy * sinT + vz * cosT;
        vy = v_y;
        vz = v_z;

        velocities[i3] = vx;
        velocities[i3 + 1] = vy;
        velocities[i3 + 2] = vz;

        const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;

        sizes[index] = 4 + Math.random() * 6;
        lifetimes[index] = 0.5 + Math.random() * 0.5;
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
            0.7,
        );
        this.composer.addPass(this.bloomPass);

        // Chromatic aberration
        this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
        this.chromaticPass.uniforms.amount.value = 0.002;
        this.composer.addPass(this.chromaticPass);

        // Vignette
        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms.darkness.value = 0.5;
        vignettePass.uniforms.offset.value = 1.2;
        this.composer.addPass(vignettePass);

        console.log('[BlackHole] Post-processing setup complete');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.onPieceLock();
            }
        });

        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Event Effects
    // ─────────────────────────────────────────────────────────────────────────

    onPieceLock() {
        // Quick flash on piece lock
        this.coreTargetIntensity = 2.0;
        this.starFlashIntensity = 0.5;
        this.bloomPulseIntensity = 0.2;
        this.chromaticPulse = 0.005;

        // Quick return to normal
        setTimeout(() => {
            this.coreTargetIntensity = 1.0;
        }, 100);
    }

    onLineClear(lineCount) {
        // Intensity scales with lines
        const intensity = 1 + lineCount * 0.3;

        this.diskTargetIntensity = intensity;
        this.coreTargetIntensity = intensity * 1.5;
        this.diskTargetRotationSpeed = 1 + lineCount * 0.5;
        this.starFlashIntensity = Math.min(1.0, lineCount * 0.3);
        this.bloomPulseIntensity = lineCount * 0.15;
        this.chromaticPulse = lineCount * 0.003;

        // Gradual return to normal
        setTimeout(() => {
            this.diskTargetIntensity = 1.0;
            this.coreTargetIntensity = 1.0;
            this.diskTargetRotationSpeed = 1.0;
        }, 500);
    }

    onCombo(comboCount) {
        if (!this.isActive || comboCount < 2) return;

        // Visual flare
        this.starFlashIntensity = Math.min(1.0, 0.2 + comboCount * 0.1);
        this.bloomPulseIntensity = Math.min(0.5, 0.1 + comboCount * 0.05);

        // Phase 1: Strong suction for higher combos
        this.gravitySurgeFactor = 2.0 + comboCount * 1.5;
        this.burstPhase = false;

        // Particle jets for big combos
        if (comboCount > 3) {
            console.log('[BlackHole] Combo > 3, gravity surge:', this.gravitySurgeFactor);
        }

        // Phase 2: Trigger burst after suction pulls particles in
        const suctionDuration = 300 + comboCount * 50; // Longer suction for bigger combos
        setTimeout(() => {
            if (!this.isActive) return;

            // Stop suction and trigger burst
            this.gravitySurgeFactor = 0;
            this.burstPhase = true;
            this.burstFactor = 3.0 + comboCount * 2.0; // Stronger burst for bigger combos

            // Extra visual punch during burst
            this.starFlashIntensity = Math.min(1.5, 0.5 + comboCount * 0.2);
            this.bloomPulseIntensity = Math.min(0.8, 0.3 + comboCount * 0.1);
            this.chromaticPulse = 0.008 + comboCount * 0.002;

            // Trigger shader-based burst sparks explosion from the pool!
            // Use round-robin allocation so multiple bursts can overlap
            if (this.burstSparksPool.length > 0) {
                const burstSparks = this.burstSparksPool[this.nextBurstIndex];
                if (burstSparks?.material?.uniforms) {
                    burstSparks.material.uniforms.uPulseTimer.value = 0.0;
                }
                this.nextBurstIndex = (this.nextBurstIndex + 1) % this.burstPoolSize;
                console.log('[BlackHole] Triggered burst system', this.nextBurstIndex, 'of', this.burstPoolSize);
            }

            // Spawn burst particles from center for extra impact
            this.spawnBurstParticles(comboCount);

            console.log('[BlackHole] Burst triggered! Factor:', this.burstFactor);
        }, suctionDuration);

        // Gradual return to normal
        setTimeout(() => {
            this.diskTargetIntensity = 1.0;
            this.coreTargetIntensity = 1.0;
            this.diskTargetRotationSpeed = 1.0;
        }, 800 + comboCount * 100);
    }

    /**
     * Spawn particles from center during burst for explosive effect
     */
    spawnBurstParticles(comboCount) {
        if (!this.particles) return;

        const positions = this.particles.geometry.attributes.position.array;
        const velocities = this.particleVelocities;
        const colors = this.particles.geometry.attributes.color.array;
        const sizes = this.particles.geometry.attributes.size.array;
        const lifetimes = this.particleLifetimes;

        const bhX = this.driftX || 0;
        const bhY = this.driftY || 0;
        const bhZ = 0;

        // Number of particles to spawn from center
        const burstCount = Math.min(comboCount * 15, 80);

        for (let i = 0; i < burstCount; i++) {
            // Find a random particle to repurpose
            const index = Math.floor(Math.random() * (positions.length / 3));
            const i3 = index * 3;

            // Spawn at black hole center with small random offset
            positions[i3] = bhX + (Math.random() - 0.5) * 30;
            positions[i3 + 1] = bhY + (Math.random() - 0.5) * 30;
            positions[i3 + 2] = bhZ + (Math.random() - 0.5) * 30;

            // Explosive outward velocity in random direction
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const speed = 8 + Math.random() * 12 + comboCount * 2;

            velocities[i3] = Math.sin(phi) * Math.cos(theta) * speed;
            velocities[i3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
            velocities[i3 + 2] = Math.cos(phi) * speed;

            // Bright hot colors for burst particles
            const colorChoice = Math.random();
            if (colorChoice < 0.3) {
                // White-hot
                colors[i3] = 1.0;
                colors[i3 + 1] = 1.0;
                colors[i3 + 2] = 0.9;
            } else if (colorChoice < 0.6) {
                // Orange-yellow
                colors[i3] = 1.0;
                colors[i3 + 1] = 0.7;
                colors[i3 + 2] = 0.2;
            } else {
                // Cyan-blue
                colors[i3] = 0.4;
                colors[i3 + 1] = 0.8;
                colors[i3 + 2] = 1.0;
            }

            // Larger, brighter particles for burst
            sizes[index] = 6 + Math.random() * 8;
            lifetimes[index] = 1.0;
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;
        this.particles.geometry.attributes.size.needsUpdate = true;
    }

    spawnJetParticles(comboCount) {
        // Add jet particles shooting from poles
        const positions = this.particles.geometry.attributes.position.array;
        const velocities = this.particleVelocities;
        const colors = this.particles.geometry.attributes.color.array;
        const sizes = this.particles.geometry.attributes.size.array;
        const lifetimes = this.particleLifetimes;

        const jetCount = Math.min(comboCount * 10, 50);

        for (let i = 0; i < jetCount; i++) {
            // Find a particle to repurpose
            const index = Math.floor(Math.random() * (positions.length / 3));
            const i3 = index * 3;

            // Spawn at center
            positions[i3] = (Math.random() - 0.5) * 20;
            positions[i3 + 1] = (Math.random() - 0.5) * 20;
            positions[i3 + 2] = (Math.random() - 0.5) * 20;

            // Jet velocity (up or down)
            const direction = Math.random() > 0.5 ? 1 : -1;
            const speed = 5 + Math.random() * 10;
            velocities[i3] = (Math.random() - 0.5) * 2;
            velocities[i3 + 1] = direction * speed;
            velocities[i3 + 2] = (Math.random() - 0.5) * 2;

            // Blue/red for Doppler effect
            if (direction > 0) {
                colors[i3] = 0.4;
                colors[i3 + 1] = 0.6;
                colors[i3 + 2] = 1.0;
            } else {
                colors[i3] = 1.0;
                colors[i3 + 1] = 0.3;
                colors[i3 + 2] = 0.2;
            }

            sizes[index] = 4 + Math.random() * 4;
            lifetimes[index] = 1.0;
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;
        this.particles.geometry.attributes.size.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;

            // Smooth intensity transitions
            this.diskIntensity += (this.diskTargetIntensity - this.diskIntensity) * 0.1;
            this.coreIntensity += (this.coreTargetIntensity - this.coreIntensity) * 0.15;
            this.diskRotationSpeed += (this.diskTargetRotationSpeed - this.diskRotationSpeed) * 0.05;

            // Decay flash effects
            if (this.starFlashIntensity > 0) {
                this.starFlashIntensity *= 0.92;
                if (this.starFlashIntensity < 0.01) this.starFlashIntensity = 0;
            }
            if (this.bloomPulseIntensity > 0) {
                this.bloomPulseIntensity *= 0.94;
                if (this.bloomPulseIntensity < 0.005) this.bloomPulseIntensity = 0;
            }
            if (this.chromaticPulse > 0.002) {
                this.chromaticPulse *= 0.95;
            }
            if (this.gravitySurgeFactor > 0) {
                this.gravitySurgeFactor *= 0.95; // Smooth decay
                if (this.gravitySurgeFactor < 0.01) this.gravitySurgeFactor = 0;
            }
            if (this.burstFactor > 0) {
                this.burstFactor *= 0.96; // Slightly slower decay for visible burst
                if (this.burstFactor < 0.01) {
                    this.burstFactor = 0;
                    this.burstPhase = false;
                }
            }

            // Update shaders
            if (this.blackHoleCore?.material?.uniforms) {
                this.blackHoleCore.material.uniforms.uTime.value = this.time;
                this.blackHoleCore.material.uniforms.uIntensity.value = this.coreIntensity;
            }

            if (this.accretionDisk?.material?.uniforms) {
                this.accretionDisk.material.uniforms.uTime.value = this.time;
                this.accretionDisk.material.uniforms.uIntensity.value = this.diskIntensity;
                this.accretionDisk.material.uniforms.uRotationSpeed.value = this.diskRotationSpeed;
            }

            if (this.innerDisk?.material?.uniforms) {
                this.innerDisk.material.uniforms.uTime.value = this.time * 1.3;
                this.innerDisk.material.uniforms.uIntensity.value = this.diskIntensity * 1.2;
                this.innerDisk.material.uniforms.uRotationSpeed.value = this.diskRotationSpeed * 1.5;
            }

            if (this.starfield?.material?.uniforms) {
                this.starfield.material.uniforms.uTime.value = this.time;
                this.starfield.material.uniforms.uFlashIntensity.value = this.starFlashIntensity;
            }

            // Update all burst sparks in the pool
            this.burstSparksPool.forEach((burstSparks) => {
                if (burstSparks?.material?.uniforms) {
                    burstSparks.material.uniforms.uTime.value = this.time;

                    // Advance pulse wave when active
                    if (burstSparks.material.uniforms.uPulseTimer.value > -50.0) {
                        // Move wave outwards - speed controls explosion rate
                        burstSparks.material.uniforms.uPulseTimer.value += delta * 18.0;

                        // Turn off when wave completes (maxLife 45 + stagger 3 + buffer)
                        if (burstSparks.material.uniforms.uPulseTimer.value > 60.0) {
                            burstSparks.material.uniforms.uPulseTimer.value = -100.0;
                        }
                    }
                }
            });

            // Black hole floating/drifting motion - Full Screen Wander
            // Use superposition of sine waves for smooth non-repeating random-looking motion
            const widthRange = window.innerWidth * 0.35; // Cover ~70% of width
            const heightRange = window.innerHeight * 0.35; // Cover ~70% of height

            // Slow time factor for "slow pace" - reduced from 0.05 to 0.01
            const t = this.time * 0.01;

            this.driftX = (Math.sin(t + this.driftPhaseX) + Math.cos(t * 1.34 + this.driftPhaseX)) * 0.5 * widthRange;
            this.driftY = (Math.cos(t * 0.89 + this.driftPhaseY) + Math.sin(t * 1.67 + this.driftPhaseY)) * 0.5 * heightRange;

            if (this.blackHoleCore) {
                this.blackHoleCore.position.x = this.driftX;
                this.blackHoleCore.position.y = this.driftY;
            }
            if (this.eventHorizonSphere) {
                this.eventHorizonSphere.position.x = this.driftX;
                this.eventHorizonSphere.position.y = this.driftY;
            }
            if (this.accretionDisk) {
                this.accretionDisk.position.x = this.driftX;
                this.accretionDisk.position.y = this.driftY;
            }
            if (this.innerDisk) {
                this.innerDisk.position.x = this.driftX;
                this.innerDisk.position.y = this.driftY;
            }

            // Update burst sparks position to follow black hole (for all pool members)
            this.burstSparksPool.forEach((burstSparks) => {
                if (burstSparks?.material?.uniforms) {
                    burstSparks.material.uniforms.uBlackHolePos.value.set(this.driftX, this.driftY);
                }
            });

            // Update particles
            this.updateParticles(delta);

            // Subtle nebula rotation
            this.nebulaClouds.forEach((cloud) => {
                cloud.rotation.z += 0.0001;
            });

            // Post-processing updates
            if (this.bloomPass) {
                this.bloomPass.strength = this.qualityPreset.bloomStrength * (1 + this.bloomPulseIntensity);
            }
            if (this.chromaticPass) {
                this.chromaticPass.uniforms.amount.value = Math.max(0.002, this.chromaticPulse);
            }

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

    updateParticles(delta) {
        if (!this.particles) return;

        const positions = this.particles.geometry.attributes.position.array;
        const velocities = this.particleVelocities;
        const lifetimes = this.particleLifetimes;

        const bhX = this.driftX || 0;
        const bhY = this.driftY || 0;
        const bhZ = 0;
        const pullStrength = 0.3;
        const maxSpeed = 5;

        for (let i = 0; i < positions.length / 3; i++) {
            const i3 = i * 3;

            // Calculate direction to black hole
            const dx = bhX - positions[i3];
            const dy = bhY - positions[i3 + 1];
            const dz = bhZ - positions[i3 + 2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist > 50) {
                // Spiral motion calculation
                const speed = Math.sqrt(
                    velocities[i3] * velocities[i3] +
                    velocities[i3 + 1] * velocities[i3 + 1] +
                    velocities[i3 + 2] * velocities[i3 + 2]
                );

                // BURST PHASE: Push particles outward
                if (this.burstPhase && this.burstFactor > 0) {
                    // Normalize direction from black hole center
                    const nx = -dx / dist;
                    const ny = -dy / dist;
                    const nz = -dz / dist;

                    // Outward force - stronger when closer to center, scaled by burstFactor
                    const burstStrength = this.burstFactor * (400.0 / (dist + 50)) * delta;

                    velocities[i3] += nx * burstStrength;
                    velocities[i3 + 1] += ny * burstStrength;
                    velocities[i3 + 2] += nz * burstStrength;

                    // Less drag during burst to let particles fly out
                    velocities[i3] *= 0.998;
                    velocities[i3 + 1] *= 0.998;
                    velocities[i3 + 2] *= 0.998;

                    // Higher max speed during burst
                    const maxSpeed = 15.0 + this.burstFactor * 3.0;
                    if (speed > maxSpeed) {
                        const scale = maxSpeed / speed;
                        velocities[i3] *= scale;
                        velocities[i3 + 1] *= scale;
                        velocities[i3 + 2] *= scale;
                    }
                } else {
                    // NORMAL/SUCTION PHASE: Pull particles inward

                    // Gravity pull - increases closer to center
                    // Reduced from 1200 to 800 for even slower "floating" feel
                    let pullStrength = (800.0 / (dist * dist + 100)) * delta;

                    // STRONG suction during combos
                    if (this.gravitySurgeFactor > 0) {
                        pullStrength *= (5.0 + this.gravitySurgeFactor * 2.0);
                    }

                    velocities[i3] += dx * pullStrength;
                    velocities[i3 + 1] += dy * pullStrength;
                    velocities[i3 + 2] += dz * pullStrength;

                    // Tangential acceleration REMOVED - rely on natural gravity + drag for organic spiral
                    // This prevents the "off" feeling of forced planar motion

                    velocities[i3] *= 0.995; // Less drag to maintain orbit longer
                    velocities[i3 + 1] *= 0.995;
                    velocities[i3 + 2] *= 0.995;

                    // Damping / Speed limit
                    velocities[i3] *= 0.99;
                    velocities[i3 + 1] *= 0.99;
                    velocities[i3 + 2] *= 0.99;

                    // Limit max speed so they don't teleport
                    const maxSpeed = 8.0 + this.gravitySurgeFactor * 5.0; // Allow faster speed during surge
                    if (speed > maxSpeed) {
                        const scale = maxSpeed / speed;
                        velocities[i3] *= scale;
                        velocities[i3 + 1] *= scale;
                        velocities[i3 + 2] *= scale;
                    }
                }
            }

            // Update position
            positions[i3] += velocities[i3];
            positions[i3 + 1] += velocities[i3 + 1];
            positions[i3 + 2] += velocities[i3 + 2];

            // Reset if too close or too far (allow further travel during burst)
            const maxDist = this.burstPhase ? 2500 : 1500;
            if (dist < 80 || dist > maxDist) {
                this.initParticle(
                    i,
                    positions,
                    velocities,
                    this.particles.geometry.attributes.color.array,
                    this.particles.geometry.attributes.size.array,
                    lifetimes,
                    this.particleColors,
                );
            }

            // Decay lifetime
            if (lifetimes[i] < 1.0) {
                lifetimes[i] += delta * 0.5;
                if (lifetimes[i] > 1.0) lifetimes[i] = 1.0;
            }
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.lifetime.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────────

    resize(width, height) {
        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
        if (this.renderer) this.renderer.setSize(width, height);
        if (this.composer) this.composer.setSize(width, height);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup
    // ─────────────────────────────────────────────────────────────────────────

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
        this.blackHoleCore = null;
        this.accretionDisk = null;
        this.starfield = null;
        this.particles = null;
        this.burstSparksPool = [];
        this.nextBurstIndex = 0;
        this.nebulaClouds = [];

        super.cleanup();
    }
}
