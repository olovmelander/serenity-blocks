/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ STELLAR VELOCITY ✧
 *  A 3D Warp Drive Space Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - GPU-accelerated 3D starfield with dynamic warp trails
 * - Volumetric nebula backdrop with procedural shaders
 * - Central warp core with pulsing energy effects
 * - Asteroid field for depth and parallax
 * - Post-processing: Bloom, Vignette, Chromatic Aberration
 * - Event-driven effects (combos, line clears, piece locks)
 * - Multiple color scheme cycling
 *
 * Architecture inspired by stellar-drift, identity unique to stellar-velocity.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { STELLAR_VELOCITY_TETROMINOS } from './stellar-velocity-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 5000,
        asteroidCount: 500,
        nebulaCount: 9,
        bloomStrength: 0.5,
        bloomRadius: 0.6,
        enableChromatic: true,
        enablePostProcessing: true,
    },
    Ultra: {
        starCount: 4000,
        asteroidCount: 400,
        nebulaCount: 7,
        bloomStrength: 0.45,
        bloomRadius: 0.55,
        enableChromatic: true,
        enablePostProcessing: true,
    },
    High: {
        starCount: 3000,
        asteroidCount: 300,
        nebulaCount: 6,
        bloomStrength: 0.4,
        bloomRadius: 0.5,
        enableChromatic: true,
        enablePostProcessing: true,
    },
    Medium: {
        starCount: 2000,
        asteroidCount: 200,
        nebulaCount: 4,
        bloomStrength: 0.35,
        bloomRadius: 0.45,
        enableChromatic: false,
        enablePostProcessing: true,
    },
    Low: {
        starCount: 1000,
        asteroidCount: 100,
        nebulaCount: 3,
        bloomStrength: 0.25,
        bloomRadius: 0.4,
        enableChromatic: false,
        enablePostProcessing: false,
    },
    Minimal: {
        starCount: 500,
        asteroidCount: 50,
        nebulaCount: 2,
        bloomStrength: 0.15,
        bloomRadius: 0.3,
        enableChromatic: false,
        enablePostProcessing: false,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader (Tunnel Vision Effect)
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
// Chromatic Aberration Shader (High-Speed Warp Effect)
// ─────────────────────────────────────────────────────────────────────────────
const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        intensity: { value: 0.0 },
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
        uniform float intensity;
        varying vec2 vUv;
        
        void main() {
            vec2 dir = vUv - 0.5;
            float dist = length(dir);
            vec2 offset = dir * dist * intensity * 0.02;
            
            float r = texture2D(tDiffuse, vUv + offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - offset).b;
            
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class StellarVelocityTheme extends BaseTheme {
    constructor() {
        super('stellar-velocity');

        // Three.js core
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.starfield = null;
        this.warpCore = null;
        this.warpCoreGlow = null;
        this.warpCoreRings = [];
        this.nebulaMeshes = [];
        this.asteroids = [];
        this.burstParticles = [];
        this.shockwaveRings = [];

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // Warp drive state
        this.baseSpeed = 0.03;
        this.currentSpeed = this.baseSpeed;
        this.targetSpeed = this.baseSpeed;
        this.maxSpeed = 12.0;
        this.acceleration = 0.05;

        // FOV and tunnel effects
        this.baseFOV = 75;
        this.currentFOV = this.baseFOV;
        this.targetFOV = this.baseFOV;
        this.baseTunnelRadius = 1500;
        this.tunnelRadius = this.baseTunnelRadius;
        this.targetTunnelRadius = this.baseTunnelRadius;

        // Color scheme cycling
        this.currentColorScheme = 0;
        this.colorSchemes = [
            {
                name: 'classic', primary: new THREE.Color(0xffffff), secondary: new THREE.Color(0x88ccff), bg: 0x000000,
            },
            {
                name: 'nebula', primary: new THREE.Color(0x00ffff), secondary: new THREE.Color(0x0088ff), bg: 0x000510,
            },
            {
                name: 'solar', primary: new THREE.Color(0xffd700), secondary: new THREE.Color(0xff8800), bg: 0x001020,
            },
            {
                name: 'aurora', primary: new THREE.Color(0x00ff88), secondary: new THREE.Color(0x00ffcc), bg: 0x000815,
            },
            {
                name: 'crimson', primary: new THREE.Color(0xff4466), secondary: new THREE.Color(0xff0044), bg: 0x100005,
            },
        ];
        this.colorCycleInterval = null;

        // Effect intensities (smooth interpolation)
        this.bloomPulseIntensity = 0;
        this.chromaticIntensity = 0;
        this.warpCoreGlowIntensity = 0.5;
        this.starTwinkleBoost = 0;
        this.cameraShake = new THREE.Vector3(0, 0, 0);

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[StellarVelocity] Theme constructed (Three.js)');
    }

    getTetrominoConfig() {
        return STELLAR_VELOCITY_TETROMINOS;
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

    // ─────────────────────────────────────────────────────────────────────────
    // Scene Creation
    // ─────────────────────────────────────────────────────────────────────────

    async createScene() {
        console.log('[StellarVelocity] Creating Three.js warp drive scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('stellar-velocity-theme');
        if (!container) {
            console.error('[StellarVelocity] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createStarfield();
        this.createNebulaBackdrop();
        this.createWarpCore();
        this.createAsteroidField();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();
        this.startColorCycle();

        console.log('[StellarVelocity] Scene created successfully');
    }

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(this.colorSchemes[this.currentColorScheme].bg, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Camera positioned behind the warp tunnel looking forward
        this.camera = new THREE.PerspectiveCamera(this.baseFOV, width / height, 0.1, 100000);
        this.camera.position.set(0, 0, 1000);
        this.camera.lookAt(0, 0, 0);

        // Ambient light
        const ambientLight = new THREE.AmbientLight(0x404060, 0.3);
        this.scene.add(ambientLight);

        // Point light at warp core
        this.coreLight = new THREE.PointLight(0xffffff, 1.0, 2000);
        this.coreLight.position.set(0, 0, 0);
        this.scene.add(this.coreLight);

        console.log('[StellarVelocity] Renderer and camera initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield with Warp Trails (GPU Shader)
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const { starCount } = this.qualityPreset;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const velocities = new Float32Array(starCount); // Z velocity factor
        const twinkleData = new Float32Array(starCount * 2);

        const colorScheme = this.colorSchemes[this.currentColorScheme];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const i2 = i * 2;

            // Cylindrical distribution around the tunnel
            const angle = Math.random() * Math.PI * 2;
            const radius = 100 + Math.random() * this.baseTunnelRadius;
            const z = Math.random() * -8000; // Stars spread along Z axis

            positions[i3] = Math.cos(angle) * radius;
            positions[i3 + 1] = Math.sin(angle) * radius;
            positions[i3 + 2] = z;

            // Color with slight variation
            const colorLerp = Math.random();
            const starColor = colorScheme.primary.clone().lerp(colorScheme.secondary, colorLerp);
            colors[i3] = starColor.r;
            colors[i3 + 1] = starColor.g;
            colors[i3 + 2] = starColor.b;

            // Size
            sizes[i] = 20 + Math.random() * 40;

            // Velocity factor (stars further from center move slower)
            velocities[i] = 0.5 + Math.random() * 0.5;

            // Twinkle
            twinkleData[i2] = Math.random() * Math.PI * 2;
            twinkleData[i2 + 1] = 1.0 + Math.random() * 2.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkleData, 2));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uWarpSpeed: { value: 0 },
                uTwinkleBoost: { value: 0 },
                uTexture: { value: this.getStarTexture() },
            },
            vertexShader: `
                attribute float aSize;
                attribute float aVelocity;
                attribute vec2 aTwinkle;

                uniform float uTime;
                uniform float uPixelRatio;
                uniform float uWarpSpeed;
                uniform float uTwinkleBoost;

                varying vec3 vColor;
                varying float vBrightness;
                varying float vTrailLength;

                void main() {
                    vColor = color;

                    // Gentle brightness twinkle
                    float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
                    vBrightness = 0.7 + twinkle * 0.3 + uTwinkleBoost;

                    // Trail length based on warp speed
                    vTrailLength = uWarpSpeed * aVelocity;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                    // Size increases slightly at high warp
                    float warpSizeBoost = 1.0 + uWarpSpeed * 0.3;
                    gl_PointSize = aSize * uPixelRatio * warpSizeBoost * (400.0 / -mvPosition.z);
                    gl_PointSize = clamp(gl_PointSize, 2.0, 80.0);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;
                uniform float uWarpSpeed;

                varying vec3 vColor;
                varying float vBrightness;
                varying float vTrailLength;

                void main() {
                    vec2 center = gl_PointCoord - 0.5;
                    
                    // Elongate the point into a trail when warping
                    vec2 trailCenter = center;
                    trailCenter.y *= 1.0 + vTrailLength * 3.0; // Stretch vertically
                    
                    float dist = length(trailCenter) * 2.0;
                    
                    // Soft circular falloff with trail
                    float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);
                    
                    // Brighter core
                    float core = 1.0 - smoothstep(0.0, 0.3, dist);
                    
                    vec3 finalColor = vColor * vBrightness * (1.0 + core * 0.5);
                    float alpha = softCircle * (vBrightness + 0.2);

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
        console.log(`[StellarVelocity] Starfield created with ${starCount} stars`);
    }

    getStarTexture() {
        if (this._starTexture) return this._starTexture;

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const center = 64;

        ctx.clearRect(0, 0, 128, 128);

        // Outer glow
        const outerGlow = ctx.createRadialGradient(center, center, 0, center, center, 64);
        outerGlow.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        outerGlow.addColorStop(0.2, 'rgba(255, 255, 255, 0.15)');
        outerGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
        outerGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = outerGlow;
        ctx.fillRect(0, 0, 128, 128);

        // Bright core
        const coreGlow = ctx.createRadialGradient(center, center, 0, center, center, 20);
        coreGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
        coreGlow.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        coreGlow.addColorStop(0.7, 'rgba(255, 255, 255, 0.2)');
        coreGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = coreGlow;
        ctx.fillRect(0, 0, 128, 128);

        this._starTexture = new THREE.CanvasTexture(canvas);
        return this._starTexture;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Backdrop (Procedural Shader)
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaBackdrop() {
        const { nebulaCount } = this.qualityPreset;
        const nebulaColors = [
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0x0066ff), // Blue
            new THREE.Color(0x6600ff), // Purple
            new THREE.Color(0xff0066), // Magenta
            new THREE.Color(0xff6600), // Orange
            new THREE.Color(0x00ff66), // Green
            new THREE.Color(0xff0044), // Crimson
            new THREE.Color(0xffcc00), // Gold
            new THREE.Color(0x8800ff), // Violet
        ];

        for (let i = 0; i < nebulaCount; i++) {
            const size = 60000 + Math.random() * 40000;
            const color = nebulaColors[i % nebulaColors.length];

            const geometry = new THREE.PlaneGeometry(size, size * 0.6);
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: color },
                    uOpacity: { value: 0.25 + Math.random() * 0.15 },
                    uPulse: { value: 0 },
                    uSeed: { value: Math.random() * 100 },
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
                    uniform vec3 uColor;
                    uniform float uOpacity;
                    uniform float uPulse;
                    uniform float uSeed;
                    
                    varying vec2 vUv;
                    
                    // Simplex noise functions
                    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
                    
                    float snoise(vec2 v) {
                        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                                           -0.577350269189626, 0.024390243902439);
                        vec2 i  = floor(v + dot(v, C.yy));
                        vec2 x0 = v -   i + dot(i, C.xx);
                        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                        vec4 x12 = x0.xyxy + C.xxzz;
                        x12.xy -= i1;
                        i = mod289(i);
                        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                                        + i.x + vec3(0.0, i1.x, 1.0));
                        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                                                dot(x12.zw,x12.zw)), 0.0);
                        m = m*m; m = m*m;
                        vec3 x = 2.0 * fract(p * C.www) - 1.0;
                        vec3 h = abs(x) - 0.5;
                        vec3 ox = floor(x + 0.5);
                        vec3 a0 = x - ox;
                        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                        vec3 g;
                        g.x = a0.x * x0.x + h.x * x0.y;
                        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                        return 130.0 * dot(m, g);
                    }
                    
                    float fbm(vec2 p) {
                        float value = 0.0;
                        float amplitude = 0.5;
                        for (int i = 0; i < 5; i++) {
                            value += amplitude * snoise(p);
                            p *= 2.0;
                            amplitude *= 0.5;
                        }
                        return value;
                    }
                    
                    void main() {
                        vec2 uv = vUv;
                        
                        // Animated noise for nebula texture
                        float noise = fbm(uv * 3.0 + uSeed + uTime * 0.02);
                        noise = noise * 0.5 + 0.5;
                        
                        // Edge fade
                        float fadeX = smoothstep(0.0, 0.4, uv.x) * smoothstep(1.0, 0.6, uv.x);
                        float fadeY = smoothstep(0.0, 0.4, uv.y) * smoothstep(1.0, 0.6, uv.y);
                        float fade = fadeX * fadeY;
                        
                        // Color with noise variation
                        vec3 color = uColor * (0.5 + noise * 0.5);
                        color += color * uPulse * 1.5; // Bright flash on pulse
                        
                        float alpha = noise * (uOpacity + uPulse * 0.2) * fade;
                        
                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });

            const mesh = new THREE.Mesh(geometry, material);

            // Position nebulas in a ring around the tunnel
            const angle = (i / nebulaCount) * Math.PI * 2 + Math.random() * 0.5;
            const distance = 20000 + Math.random() * 15000;
            mesh.position.x = Math.cos(angle) * distance;
            mesh.position.y = Math.sin(angle) * distance * 0.3 + (Math.random() - 0.5) * 5000;
            mesh.position.z = -30000 - Math.random() * 20000;

            mesh.rotation.z = Math.random() * Math.PI;
            mesh.userData.driftSpeed = 0.5 + Math.random() * 0.5;
            mesh.userData.driftPhase = Math.random() * Math.PI * 2;

            this.nebulaMeshes.push(mesh);
            this.scene.add(mesh);
        }

        console.log(`[StellarVelocity] ${nebulaCount} procedural nebulas created`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Warp Core (Central Energy Vortex)
    // ─────────────────────────────────────────────────────────────────────────

    createWarpCore() {
        // Inner energy sphere
        const coreGeometry = new THREE.SphereGeometry(80, 32, 32);
        const coreMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uGlowIntensity: { value: 0.5 },
                uColor: { value: this.colorSchemes[this.currentColorScheme].primary },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uGlowIntensity;
                uniform vec3 uColor;
                varying vec3 vNormal;
                varying vec3 vPosition;
                
                void main() {
                    // Fresnel effect for rim glow
                    vec3 viewDir = normalize(cameraPosition - vPosition);
                    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.0);
                    
                    // Pulsing energy
                    float pulse = sin(uTime * 3.0) * 0.2 + 0.8;
                    
                    // Swirling pattern
                    float swirl = sin(vPosition.y * 0.1 + uTime * 2.0) * 0.5 + 0.5;
                    
                    vec3 color = uColor * (uGlowIntensity + fresnel * 0.5) * pulse;
                    color += vec3(1.0) * fresnel * 0.3; // White rim
                    
                    float alpha = 0.8 + fresnel * 0.2;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.warpCore = new THREE.Mesh(coreGeometry, coreMaterial);
        this.warpCore.position.set(0, 0, -500);
        this.scene.add(this.warpCore);

        // Glow planes
        this.createGlowPlane(400, this.colorSchemes[this.currentColorScheme].primary, 0.6, -500, 0, 'small');
        this.createGlowPlane(700, this.colorSchemes[this.currentColorScheme].secondary, 0.4, -510, 0, 'big');

        // Energy rings
        for (let i = 0; i < 3; i++) {
            const ringGeometry = new THREE.TorusGeometry(120 + i * 40, 3, 16, 64);
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: this.colorSchemes[this.currentColorScheme].primary,
                transparent: true,
                opacity: 0.6 - i * 0.15,
                blending: THREE.AdditiveBlending,
            });

            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.position.set(0, 0, -500);
            ring.rotation.x = Math.PI / 2 + Math.random() * 0.3;
            ring.userData.rotationSpeed = 0.5 + Math.random() * 0.5;
            ring.userData.rotationAxis = Math.random() > 0.5 ? 'x' : 'y';

            this.warpCoreRings.push(ring);
            this.scene.add(ring);
        }

        console.log('[StellarVelocity] Warp core created');
    }

    createGlowPlane(size, color, opacity, zPos, yPos, name) {
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
            color,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const plane = new THREE.Mesh(geometry, material);
        plane.position.set(0, yPos, zPos);
        this.scene.add(plane);

        if (name === 'small') {
            this.warpCoreGlow = plane;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Asteroid Field
    // ─────────────────────────────────────────────────────────────────────────

    createAsteroidField() {
        const count = this.qualityPreset.asteroidCount;

        const material = new THREE.MeshStandardMaterial({
            color: 0x444444,
            emissive: 0x111122,
            roughness: 0.8,
            metalness: 0.2,
            flatShading: true,
        });

        // Pre-generate geometry variations
        const geometries = [];
        for (let i = 0; i < 30; i++) {
            const size = 8 + Math.random() * 25;
            const geo = new THREE.IcosahedronGeometry(size, 0);

            const positions = geo.attributes.position;
            const randomize = size * 0.3;
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

        for (let i = 0; i < count; i++) {
            const geo = geometries[Math.floor(Math.random() * geometries.length)];
            const mesh = new THREE.Mesh(geo, material);

            // Cylindrical distribution around the tunnel
            const angle = Math.random() * Math.PI * 2;
            const radius = this.baseTunnelRadius + 200 + Math.random() * 800;
            const z = -1000 - Math.random() * 6000;

            mesh.position.x = Math.cos(angle) * radius;
            mesh.position.y = Math.sin(angle) * radius;
            mesh.position.z = z;

            mesh.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI,
            );

            this.asteroids.push({
                mesh,
                rotationSpeed: {
                    x: (Math.random() - 0.5) * 0.01,
                    y: (Math.random() - 0.5) * 0.01,
                    z: (Math.random() - 0.5) * 0.01,
                },
                orbitSpeed: (Math.random() - 0.5) * 0.0005,
                angle,
                radius,
            });

            this.scene.add(mesh);
        }

        console.log(`[StellarVelocity] ${count} asteroids created`);
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

        // Bloom
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(width, height),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.85,
        );
        this.composer.addPass(this.bloomPass);

        // Vignette
        this.vignettePass = new ShaderPass(VignetteShader);
        this.vignettePass.uniforms.darkness.value = 0.4;
        this.vignettePass.uniforms.offset.value = 1.1;
        this.composer.addPass(this.vignettePass);

        // Chromatic Aberration (only on high quality)
        if (this.qualityPreset.enableChromatic) {
            this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
            this.chromaticPass.uniforms.intensity.value = 0;
            this.composer.addPass(this.chromaticPass);
        }

        console.log('[StellarVelocity] Post-processing setup complete');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock();
            }
        });

        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
        console.log('[StellarVelocity] Event listeners set up');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Handlers
    // ─────────────────────────────────────────────────────────────────────────

    onLineClear(lineCount) {
        // Gentle speed boost
        const speedBoost = lineCount * 0.05;
        this.targetSpeed = Math.min(this.baseSpeed * 2, this.baseSpeed + speedBoost);

        // Star twinkle flash
        this.starTwinkleBoost = 0.3;

        // Tetris (4 lines) gets extra effects
        if (lineCount >= 4) {
            this.targetTunnelRadius = 1200;
            this.targetFOV = this.baseFOV - 5;
            this.createBurstParticles(20);
        }

        // Reset after delay
        setTimeout(() => {
            this.targetSpeed = this.baseSpeed;
            this.targetTunnelRadius = this.baseTunnelRadius;
            this.targetFOV = this.baseFOV;
        }, 1000);
    }

    onCombo(comboCount) {
        if (comboCount >= 8) {
            // MAXIMUM WARP
            this.targetSpeed = this.maxSpeed * 1.5;
            this.targetTunnelRadius = 200;
            this.targetFOV = this.baseFOV - 25;
            this.chromaticIntensity = 1.5;
            this.bloomPulseIntensity = 0.8;
            this.warpCoreGlowIntensity = 1.5;
            this.createBurstParticles(200);
            this.createShockwaveRing();
        } else if (comboCount >= 5) {
            // HIGH WARP
            this.targetSpeed = this.maxSpeed * 1.0;
            this.targetTunnelRadius = 500;
            this.targetFOV = this.baseFOV - 15;
            this.chromaticIntensity = 1.0;
            this.bloomPulseIntensity = 0.6;
            this.warpCoreGlowIntensity = 1.2;
            this.createBurstParticles(100);
        } else if (comboCount >= 3) {
            // MEDIUM WARP
            this.targetSpeed = this.maxSpeed * 0.6;
            this.targetTunnelRadius = 800;
            this.targetFOV = this.baseFOV - 10;
            this.chromaticIntensity = 0.5;
            this.bloomPulseIntensity = 0.4;
            this.warpCoreGlowIntensity = 1.0;
            this.createBurstParticles(50);
        } else {
            // LOW WARP
            this.targetSpeed = this.maxSpeed * 0.3;
            this.targetTunnelRadius = 1200;
            this.targetFOV = this.baseFOV - 5;
            this.chromaticIntensity = 0.2;
            this.bloomPulseIntensity = 0.2;
            this.warpCoreGlowIntensity = 0.8;
            this.createBurstParticles(25);
        }

        // Pulse nebulas
        this.nebulaMeshes.forEach((mesh) => {
            if (mesh.material?.uniforms?.uPulse) {
                mesh.material.uniforms.uPulse.value = Math.min(comboCount * 0.15, 0.8);
            }
        });

        // Reset after delay
        const resetDelay = 2000 + comboCount * 300;
        setTimeout(() => {
            this.targetSpeed = this.baseSpeed;
            this.targetTunnelRadius = this.baseTunnelRadius;
            this.targetFOV = this.baseFOV;
        }, resetDelay);
    }

    onPieceLock() {
        // Subtle star twinkle
        if (Math.random() < 0.3) {
            this.starTwinkleBoost = Math.max(this.starTwinkleBoost, 0.1);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Effect Creation
    // ─────────────────────────────────────────────────────────────────────────

    createBurstParticles(count) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const velocities = [];

        const colorScheme = this.colorSchemes[this.currentColorScheme];

        for (let i = 0; i < count; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = 0;
            positions[i * 3 + 2] = -500; // At warp core

            // Radial velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = 30 + Math.random() * 50;
            velocities.push({
                x: Math.cos(angle) * speed,
                y: Math.sin(angle) * speed,
                z: (Math.random() - 0.3) * speed * 0.5,
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: colorScheme.primary,
            size: 15 + Math.random() * 10,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
            map: this.getStarTexture(),
        });

        const burst = new THREE.Points(geometry, material);
        burst.userData = {
            velocities,
            life: 3.0,
            maxLife: 3.0,
        };

        this.scene.add(burst);
        this.burstParticles.push(burst);
    }

    createShockwaveRing() {
        const geometry = new THREE.RingGeometry(80, 100, 64);
        const material = new THREE.MeshBasicMaterial({
            color: this.colorSchemes[this.currentColorScheme].primary,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });

        const ring = new THREE.Mesh(geometry, material);
        ring.position.set(0, 0, -450);
        ring.userData.speed = 0.15;
        ring.userData.life = 1.0;

        this.scene.add(ring);
        this.shockwaveRings.push(ring);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Color Cycling
    // ─────────────────────────────────────────────────────────────────────────

    startColorCycle() {
        const cycleColors = () => {
            if (!this.isActive) return;

            this.currentColorScheme = (this.currentColorScheme + 1) % this.colorSchemes.length;
            const scheme = this.colorSchemes[this.currentColorScheme];

            console.log('[StellarVelocity] Color scheme changed to:', scheme.name);

            // Update renderer background
            this.renderer.setClearColor(scheme.bg, 1);

            // Update warp core color
            if (this.warpCore?.material?.uniforms?.uColor) {
                this.warpCore.material.uniforms.uColor.value = scheme.primary;
            }

            // Update warp core light
            if (this.coreLight) {
                this.coreLight.color = scheme.primary;
            }

            // Update ring colors
            this.warpCoreRings.forEach((ring) => {
                ring.material.color = scheme.primary;
            });

            // Update glow plane colors
            if (this.warpCoreGlow) {
                this.warpCoreGlow.material.color = scheme.primary;
            }

            // Schedule next cycle
            const delay = 30000 + Math.random() * 15000;
            this.colorCycleInterval = setTimeout(cycleColors, delay);
        };

        // Start first cycle after 20 seconds
        this.colorCycleInterval = setTimeout(cycleColors, 20000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        if (!this.isActive) return;

        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;

            this.updateWarpState(delta);
            this.updateStarfield();
            this.updateNebulas();
            this.updateWarpCore();
            this.updateAsteroids(delta);
            this.updateBurstParticles(delta);
            this.updateShockwaveRings(delta);
            this.updatePostProcessing();
            this.updateCamera();

            this.render();

            const animationId = requestAnimationFrame(animate);
            this.registerAnimation(animationId);
        };

        const animationId = requestAnimationFrame(animate);
        this.registerAnimation(animationId);
    }

    updateWarpState(delta) {
        // Smooth interpolation of speed
        this.currentSpeed += (this.targetSpeed - this.currentSpeed) * this.acceleration;

        // Smooth interpolation of tunnel radius
        this.tunnelRadius += (this.targetTunnelRadius - this.tunnelRadius) * 0.05;

        // Smooth interpolation of FOV
        this.currentFOV += (this.targetFOV - this.currentFOV) * 0.05;
        if (this.camera) {
            this.camera.fov = this.currentFOV;
            this.camera.updateProjectionMatrix();
        }

        // Decay effect intensities
        this.bloomPulseIntensity *= 0.95;
        this.chromaticIntensity *= 0.95;
        this.starTwinkleBoost *= 0.9;
        this.warpCoreGlowIntensity += (0.5 - this.warpCoreGlowIntensity) * 0.02;

        // Decay nebula pulse
        this.nebulaMeshes.forEach((mesh) => {
            if (mesh.material?.uniforms?.uPulse) {
                mesh.material.uniforms.uPulse.value *= 0.95;
            }
        });
    }

    updateStarfield() {
        if (!this.starfield?.material?.uniforms) return;

        const { uniforms } = this.starfield.material;
        uniforms.uTime.value = this.time;
        uniforms.uWarpSpeed.value = Math.min((this.currentSpeed / this.baseSpeed - 1) * 0.1, 1.0);
        uniforms.uTwinkleBoost.value = this.starTwinkleBoost;

        // Move stars toward camera (warp effect)
        const positions = this.starfield.geometry.attributes.position.array;
        const starCount = positions.length / 3;

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Move toward camera
            positions[i3 + 2] += this.currentSpeed * 10;

            // Reset if past camera
            if (positions[i3 + 2] > 1000) {
                const angle = Math.random() * Math.PI * 2;
                const radius = 100 + Math.random() * this.tunnelRadius;
                positions[i3] = Math.cos(angle) * radius;
                positions[i3 + 1] = Math.sin(angle) * radius;
                positions[i3 + 2] = -8000;
            }
        }

        this.starfield.geometry.attributes.position.needsUpdate = true;
    }

    updateNebulas() {
        this.nebulaMeshes.forEach((mesh) => {
            if (mesh.material?.uniforms?.uTime) {
                mesh.material.uniforms.uTime.value = this.time;
            }

            // Gentle drift
            const drift = Math.sin(this.time * 0.1 + mesh.userData.driftPhase) * 100;
            mesh.position.y += Math.sin(this.time * 0.05) * 0.5;
        });
    }

    updateWarpCore() {
        if (this.warpCore?.material?.uniforms) {
            this.warpCore.material.uniforms.uTime.value = this.time;
            this.warpCore.material.uniforms.uGlowIntensity.value = this.warpCoreGlowIntensity;
        }

        // Rotate rings
        this.warpCoreRings.forEach((ring) => {
            if (ring.userData.rotationAxis === 'x') {
                ring.rotation.x += ring.userData.rotationSpeed * 0.01;
            } else {
                ring.rotation.y += ring.userData.rotationSpeed * 0.01;
            }
        });

        // Update core light intensity
        if (this.coreLight) {
            this.coreLight.intensity = 0.5 + this.warpCoreGlowIntensity;
        }
    }

    updateAsteroids(delta) {
        this.asteroids.forEach((asteroid) => {
            // Tumble
            asteroid.mesh.rotation.x += asteroid.rotationSpeed.x;
            asteroid.mesh.rotation.y += asteroid.rotationSpeed.y;
            asteroid.mesh.rotation.z += asteroid.rotationSpeed.z;

            // Orbit
            asteroid.angle += asteroid.orbitSpeed;
            asteroid.mesh.position.x = Math.cos(asteroid.angle) * asteroid.radius;
            asteroid.mesh.position.y = Math.sin(asteroid.angle) * asteroid.radius;
        });
    }

    updateBurstParticles(delta) {
        for (let i = this.burstParticles.length - 1; i >= 0; i--) {
            const burst = this.burstParticles[i];
            const positions = burst.geometry.attributes.position.array;

            for (let j = 0; j < burst.userData.velocities.length; j++) {
                const vel = burst.userData.velocities[j];
                positions[j * 3] += vel.x * delta * 60;
                positions[j * 3 + 1] += vel.y * delta * 60;
                positions[j * 3 + 2] += vel.z * delta * 60;
            }

            burst.geometry.attributes.position.needsUpdate = true;
            burst.userData.life -= delta;
            burst.material.opacity = burst.userData.life / burst.userData.maxLife;

            if (burst.userData.life <= 0) {
                this.scene.remove(burst);
                burst.geometry.dispose();
                burst.material.dispose();
                this.burstParticles.splice(i, 1);
            }
        }
    }

    updateShockwaveRings(delta) {
        for (let i = this.shockwaveRings.length - 1; i >= 0; i--) {
            const ring = this.shockwaveRings[i];

            ring.scale.x += ring.userData.speed * 5;
            ring.scale.y += ring.userData.speed * 5;
            ring.userData.life -= delta * 0.5;
            ring.material.opacity = ring.userData.life;

            if (ring.userData.life <= 0) {
                this.scene.remove(ring);
                ring.geometry.dispose();
                ring.material.dispose();
                this.shockwaveRings.splice(i, 1);
            }
        }
    }

    updatePostProcessing() {
        if (this.bloomPass) {
            this.bloomPass.strength = this.qualityPreset.bloomStrength + this.bloomPulseIntensity;
        }

        if (this.vignettePass) {
            // More vignette at high warp (tunnel vision)
            const warpRatio = this.currentSpeed / this.maxSpeed;
            this.vignettePass.uniforms.darkness.value = 0.4 + warpRatio * 0.4;
        }

        if (this.chromaticPass) {
            this.chromaticPass.uniforms.intensity.value = this.chromaticIntensity;
        }
    }

    updateCamera() {
        // Camera shake at high speeds
        if (this.currentSpeed > 2.0) {
            const shakeIntensity = (this.currentSpeed - 2.0) * 1.5;
            this.cameraShake.set(
                (Math.random() - 0.5) * shakeIntensity,
                (Math.random() - 0.5) * shakeIntensity,
                0,
            );
        } else {
            this.cameraShake.multiplyScalar(0.9);
        }

        if (this.camera) {
            this.camera.position.x = this.cameraShake.x;
            this.camera.position.y = this.cameraShake.y;
        }
    }

    render() {
        this.renderer.clear();

        if (this.composer && this.qualityPreset.enablePostProcessing) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────────

    resize(width, height) {
        if (this.camera) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        if (this.renderer) {
            this.renderer.setSize(width, height);
        }

        if (this.composer) {
            this.composer.setSize(width, height);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stop / Cleanup
    // ─────────────────────────────────────────────────────────────────────────

    stop() {
        console.log('[StellarVelocity] stop() called');

        if (!this.isActive) return;

        if (this.colorCycleInterval) {
            clearTimeout(this.colorCycleInterval);
            this.colorCycleInterval = null;
        }

        this.eventUnsubscribers.forEach((unsub) => unsub());
        this.eventUnsubscribers = [];

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }

        super.stop();
        console.log('[StellarVelocity] Stopped successfully');
    }

    cleanup() {
        console.log('[StellarVelocity] cleanup() called');

        this.stop();

        // Dispose starfield
        if (this.starfield) {
            this.starfield.geometry.dispose();
            this.starfield.material.dispose();
        }

        // Dispose nebulas
        this.nebulaMeshes.forEach((mesh) => {
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.nebulaMeshes = [];

        // Dispose warp core
        if (this.warpCore) {
            this.warpCore.geometry.dispose();
            this.warpCore.material.dispose();
        }

        this.warpCoreRings.forEach((ring) => {
            ring.geometry.dispose();
            ring.material.dispose();
        });
        this.warpCoreRings = [];

        // Dispose asteroids
        this.asteroids.forEach((asteroid) => {
            asteroid.mesh.geometry.dispose();
            asteroid.mesh.material.dispose();
        });
        this.asteroids = [];

        // Dispose burst particles
        this.burstParticles.forEach((burst) => {
            burst.geometry.dispose();
            burst.material.dispose();
        });
        this.burstParticles = [];

        // Dispose shockwave rings
        this.shockwaveRings.forEach((ring) => {
            ring.geometry.dispose();
            ring.material.dispose();
        });
        this.shockwaveRings = [];

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement?.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }

        // Dispose composer
        if (this.composer) {
            this.composer.dispose();
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        super.cleanup();
        console.log('[StellarVelocity] Cleaned up successfully');
    }

    update() {
        // Animation updates happen in animation loop
    }
}
