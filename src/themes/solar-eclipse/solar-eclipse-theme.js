/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ☀️ SOLAR ECLIPSE ☀️
 *  A Stunning 3D Solar Eclipse Theme for Serenity Blocks
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Deep 3D Starfield with twinkling and size attenuation
 * - 3D Sun sphere with dynamic plasma shader and surface flow
 * - 3D Moon sphere with procedural crater texture and proper lighting
 * - 3D Corona particles pulsing outward from the sun
 * - 3D Solar flare particles erupting from the sun surface
 * - Orbiting space debris and meteors for depth
 * - Ambient floating particles throughout 3D space
 * - Nebula clouds at varying depths
 * - Post-processing: Bloom + Vignette
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
import { SOLAR_ECLIPSE_TETROMINOS } from './solar-eclipse-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 5000,
        coronaParticles: 1200,
        flareParticles: 600,
        meteorCount: 60,
        ambientParticles: 800,
        nebulaCount: 25,
        bloomStrength: 0.55,
        bloomRadius: 0.6,
        enablePostProcessing: true,
        moonDetail: 64,
        sunDetail: 64,
    },
    Ultra: {
        starCount: 4000,
        coronaParticles: 900,
        flareParticles: 450,
        meteorCount: 45,
        ambientParticles: 600,
        nebulaCount: 20,
        bloomStrength: 0.5,
        bloomRadius: 0.55,
        enablePostProcessing: true,
        moonDetail: 48,
        sunDetail: 48,
    },
    High: {
        starCount: 3000,
        coronaParticles: 600,
        flareParticles: 300,
        meteorCount: 35,
        ambientParticles: 400,
        nebulaCount: 15,
        bloomStrength: 0.45,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        moonDetail: 40,
        sunDetail: 40,
    },
    Medium: {
        starCount: 2000,
        coronaParticles: 400,
        flareParticles: 200,
        meteorCount: 25,
        ambientParticles: 250,
        nebulaCount: 10,
        bloomStrength: 0.4,
        bloomRadius: 0.45,
        enablePostProcessing: true,
        moonDetail: 32,
        sunDetail: 32,
    },
    Low: {
        starCount: 1000,
        coronaParticles: 200,
        flareParticles: 100,
        meteorCount: 15,
        ambientParticles: 150,
        nebulaCount: 6,
        bloomStrength: 0.3,
        bloomRadius: 0.4,
        enablePostProcessing: false,
        moonDetail: 24,
        sunDetail: 24,
    },
    Minimal: {
        starCount: 500,
        coronaParticles: 100,
        flareParticles: 50,
        meteorCount: 8,
        ambientParticles: 80,
        nebulaCount: 3,
        bloomStrength: 0.25,
        bloomRadius: 0.35,
        enablePostProcessing: false,
        moonDetail: 16,
        sunDetail: 16,
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
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class SolarEclipseTheme extends BaseTheme {
    constructor() {
        super('solar-eclipse');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;

        // Scene elements
        this.sun = null;
        this.moon = null;
        this.coronaParticles = null;
        this.flareParticles = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.meteors = [];
        this.ambientParticles = null;
        this.shootingStars = [];
        this.sunGlowLayers = [];

        // Effect states for smooth interpolation
        this.coronaPulseIntensity = 0;
        this.bloomPulseIntensity = 0;
        this.starTwinkleIntensity = 0;
        this.flareIntensity = 1.0;
        this.sunPulse = 0;

        // Moon drift animation state - continuous loop
        this.moonDriftProgress = 0; // 0 = far right, 0.5 = eclipse (center), 1.0 = far left (loops back)
        this.moonDriftBaseSpeed = 0.00012; // Base speed - very slow
        this.moonStartX = 800; // Start off to the right
        this.moonEndX = -800; // Continue to left off-screen

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        console.log('[SolarEclipse] Theme constructed');
    }

    getTetrominoConfig() {
        return SOLAR_ECLIPSE_TETROMINOS;
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
        console.log('[SolarEclipse] Creating stunning 3D eclipse scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);

        const container = document.getElementById('solar-eclipse-theme');
        if (!container) {
            console.error('[SolarEclipse] Container not found');
            return;
        }

        this.initRenderer(container);
        this.createStarfield();
        this.createNebulaClouds();
        this.createSun();
        this.createMoon();
        this.createCoronaParticles();
        this.createFlareParticles();
        this.createMeteorField();
        this.createAmbientParticles();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();

        console.log('[SolarEclipse] Scene created successfully');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: this.getAntialiasEnabled(), alpha: false });
        this.renderer.setClearColor(0x000005, 1);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.3;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Camera positioned to view the eclipse with depth
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        this.camera.position.set(0, 0, 1400);
        this.camera.lookAt(0, 0, 0);

        // Dramatic lighting - main light from behind (creating the eclipse effect)
        const backLight = new THREE.PointLight(0xffaa44, 4, 4000);
        backLight.position.set(0, 0, -350);
        this.scene.add(backLight);

        // Secondary rim light for depth
        const rimLight = new THREE.PointLight(0xff6633, 2, 2000);
        rimLight.position.set(400, 200, -200);
        this.scene.add(rimLight);

        // Very subtle ambient light
        const ambientLight = new THREE.AmbientLight(0x0a0510, 0.3);
        this.scene.add(ambientLight);

        // Directional light for meteors
        const dirLight = new THREE.DirectionalLight(0xffcc88, 0.5);
        dirLight.position.set(0.5, 0.5, 1);
        this.scene.add(dirLight);

        console.log('[SolarEclipse] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - Deep 3D stars with size attenuation
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const starCount = this.qualityPreset.starCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xffeedd),
            new THREE.Color(0xddddff),
            new THREE.Color(0xffddaa),
            new THREE.Color(0xaaddff),
            new THREE.Color(0xffccaa),
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Spread stars across a large 3D volume
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 2000 + Math.random() * 6000;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 3000; // Pushed back for depth

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1.5 + Math.random() * 4;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 3.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true, // Important for 3D depth!
            blending: THREE.AdditiveBlending,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        console.log('[SolarEclipse] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Layered at varying depths
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaClouds() {
        const cloudCount = this.qualityPreset.nebulaCount;

        for (let i = 0; i < cloudCount; i++) {
            const size = 1200 + Math.random() * 2500;

            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            // Eclipse color palette - deep purples, oranges, reds, dark blues
            const colorType = Math.random();
            let hue, sat, light;
            if (colorType < 0.35) {
                hue = 270 + Math.random() * 30;
                sat = 70;
                light = 20;
            } else if (colorType < 0.6) {
                hue = 15 + Math.random() * 35;
                sat = 75;
                light = 25;
            } else if (colorType < 0.85) {
                hue = 220 + Math.random() * 30;
                sat = 55;
                light = 15;
            } else {
                hue = 35 + Math.random() * 25;
                sat = 80;
                light = 30;
            }

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, 0.12)`);
            gradient.addColorStop(0.4, `hsla(${hue}, ${sat}%, ${light}%, 0.06)`);
            gradient.addColorStop(0.7, `hsla(${hue}, ${sat}%, ${light}%, 0.02)`);
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

            // Spread at varying depths for parallax
            cloud.position.x = (Math.random() - 0.5) * 5000;
            cloud.position.y = (Math.random() - 0.5) * 3000;
            cloud.position.z = -800 - Math.random() * 3000; // Deep in background
            cloud.rotation.z = Math.random() * Math.PI;

            this.nebulaClouds.push(cloud);
            this.scene.add(cloud);
        }

        console.log('[SolarEclipse] Nebula clouds created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sun - Large 3D Sphere with dynamic plasma surface and glow layers
    // ─────────────────────────────────────────────────────────────────────────

    createSun() {
        const sunSize = 350; // Larger sun for more presence

        const geometry = new THREE.SphereGeometry(sunSize, this.qualityPreset.sunDetail, this.qualityPreset.sunDetail);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uIntensity: { value: 1.0 },
                uPulse: { value: 0.0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vLocalPos;
                varying vec3 vViewPosition;
                
                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    vLocalPos = position;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uIntensity;
                uniform float uPulse;
                varying vec2 vUv;
                varying vec3 vNormal;
                varying vec3 vPosition;
                varying vec3 vLocalPos;
                varying vec3 vViewPosition;
                
                // 3D Noise functions for seamless surface
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
                    for (int i = 0; i < 5; i++) {
                        v += a * noise3D(p);
                        p *= 2.0;
                        a *= 0.5;
                    }
                    return v;
                }
                
                void main() {
                    // Use 3D position for seamless noise
                    vec3 pos = normalize(vLocalPos) * 5.0;
                    vec3 viewDir = normalize(vViewPosition);
                    
                    // Flowing plasma surface
                    float flow = uTime * 0.04;
                    float n1 = fbm3D(pos * vec3(2.0, 2.0, 2.0) + vec3(flow, flow * 0.5, 0.0));
                    float n2 = fbm3D(pos * vec3(3.0, 3.0, 3.0) - vec3(0.0, flow * 0.7, flow * 0.3));
                    float n3 = fbm3D(pos * vec3(5.0, 5.0, 5.0) + vec3(flow * 0.5, 0.0, flow * 0.8));
                    
                    float plasma = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
                    
                    // Hot spots / solar activity
                    float spot1 = smoothstep(0.7, 0.3, length(pos.xy - vec2(2.0, 1.5)));
                    float spot2 = smoothstep(0.6, 0.2, length(pos.xy - vec2(-1.5, 2.5)));
                    float spot3 = smoothstep(0.5, 0.15, length(pos.xz - vec2(1.0, -2.0)));
                    float spots = spot1 * 0.4 + spot2 * 0.3 + spot3 * 0.25;
                    
                    // Sun color gradient - from white core to orange/red edge
                    vec3 coreColor = vec3(1.0, 1.0, 0.95);
                    vec3 midColor = vec3(1.0, 0.75, 0.3);
                    vec3 edgeColor = vec3(1.0, 0.4, 0.12);
                    vec3 hotSpotColor = vec3(1.0, 1.0, 0.85);
                    
                    vec3 color = mix(coreColor, midColor, plasma * 0.6);
                    color = mix(color, edgeColor, plasma * 0.5);
                    color = mix(color, hotSpotColor, spots);
                    
                    // Limb darkening effect (edges slightly darker)
                    float limb = pow(abs(dot(vNormal, viewDir)), 0.4);
                    color *= 0.7 + limb * 0.3;
                    
                    // Add brightness variation
                    color *= 0.85 + plasma * 0.35 + uPulse * 0.3;
                    
                    // HDR-like intensity
                    color *= uIntensity * 1.7;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });

        this.sun = new THREE.Mesh(geometry, material);
        this.sun.position.set(0, 0, -100); // Behind where moon will be
        this.sun.renderOrder = 50;
        this.scene.add(this.sun);

        // Create sun glow layers for 3D depth
        this.createSunGlowLayers(sunSize);

        console.log('[SolarEclipse] 3D Sun with plasma shader and glow layers created');
    }

    createSunGlowLayers(sunSize) {
        const glowConfigs = [
            { size: sunSize * 2.2, color: 0xffcc66, opacity: 0.4, z: -105 },
            { size: sunSize * 2.8, color: 0xff9933, opacity: 0.25, z: -110 },
            { size: sunSize * 3.5, color: 0xff6622, opacity: 0.15, z: -115 },
            { size: sunSize * 4.2, color: 0xff4411, opacity: 0.08, z: -120 },
        ];

        for (const config of glowConfigs) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.7)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
            gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.1)');
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 256, 256);

            const texture = new THREE.CanvasTexture(canvas);
            const geometry = new THREE.PlaneGeometry(config.size, config.size);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                color: config.color,
                transparent: true,
                opacity: config.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            const glow = new THREE.Mesh(geometry, material);
            glow.position.set(0, 0, config.z);
            glow.renderOrder = 40;
            this.scene.add(glow);
            this.sunGlowLayers.push(glow);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Moon - 3D Sphere with procedural crater texture and proper lighting
    // ─────────────────────────────────────────────────────────────────────────

    createMoon() {
        const moonSize = 320; // Slightly smaller than sun for tight eclipse

        const geometry = new THREE.SphereGeometry(moonSize, this.qualityPreset.moonDetail, this.qualityPreset.moonDetail);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uEclipseProgress: { value: 0.0 }, // 0 = no eclipse, 1 = full eclipse
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec3 vLocalPos;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    vLocalPos = position;
                    vUv = uv;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    vViewPosition = -mvPosition.xyz;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uEclipseProgress;
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying vec3 vLocalPos;
                varying vec2 vUv;
                varying vec3 vWorldNormal;
                
                // 3D noise for crater texture
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
                    for (int i = 0; i < 5; i++) {
                        v += a * noise3D(p);
                        p *= 2.0;
                        a *= 0.5;
                    }
                    return v;
                }
                
                // Enhanced crater function with visible depth and rim
                float crater(vec3 pos, vec3 center, float size, float depth) {
                    float d = length(pos - center);
                    // Sharp crater bowl
                    float inside = smoothstep(size, size * 0.5, d);
                    // Raised rim around crater
                    float rim = smoothstep(size * 1.3, size * 1.0, d) * smoothstep(size * 0.8, size * 1.0, d);
                    // Central peak for larger craters
                    float peak = smoothstep(size * 0.25, size * 0.1, d) * 0.3;
                    return -inside * depth + rim * depth * 0.5 + peak * depth;
                }
                
                // Small crater for detail
                float smallCrater(vec3 pos, vec3 center, float size) {
                    float d = length(pos - center);
                    return smoothstep(size, size * 0.6, d) * 0.08;
                }
                
                void main() {
                    vec3 viewDir = normalize(vViewPosition);
                    vec3 pos = normalize(vLocalPos) * 5.0;
                    
                    // Base moon colors - grey highlands and darker maria
                    vec3 highlandColor = vec3(0.18, 0.17, 0.16); // Light grey highlands
                    vec3 mariaColor = vec3(0.08, 0.08, 0.09);    // Dark grey maria (seas)
                    vec3 craterFloor = vec3(0.05, 0.05, 0.06);   // Very dark crater floors
                    
                    // Large-scale terrain variation (highlands vs maria)
                    float highlands = fbm3D(pos * 0.8 + vec3(3.0, 1.0, 2.0));
                    float mariaRegion = smoothstep(0.35, 0.55, fbm3D(pos * 1.0 + vec3(1.0, 2.0, 0.5)));
                    float mariaRegion2 = smoothstep(0.4, 0.6, fbm3D(pos * 1.2 + vec3(-2.0, 1.0, -1.0)));
                    float totalMaria = max(mariaRegion * 0.7, mariaRegion2 * 0.5);
                    
                    // Base color blend between highlands and maria
                    vec3 baseColor = mix(highlandColor, mariaColor, totalMaria);
                    
                    // === MAJOR CRATERS (clearly visible) ===
                    float majorCraters = 0.0;
                    majorCraters += crater(pos, vec3(2.5, 0.8, 0.3), 1.1, 0.35);   // Large prominent crater
                    majorCraters += crater(pos, vec3(-1.8, 1.8, 0.8), 0.95, 0.3);  // Another large one
                    majorCraters += crater(pos, vec3(0.3, -2.0, 1.5), 0.85, 0.28); 
                    majorCraters += crater(pos, vec3(-0.8, 0.3, -2.2), 1.0, 0.32);
                    majorCraters += crater(pos, vec3(1.5, -1.0, 1.8), 0.75, 0.25);
                    majorCraters += crater(pos, vec3(-2.2, -0.8, 0.5), 0.9, 0.28);
                    majorCraters += crater(pos, vec3(0.5, 2.5, -0.3), 0.8, 0.26);
                    majorCraters += crater(pos, vec3(-1.2, -1.8, 1.2), 0.7, 0.22);
                    
                    // === MEDIUM CRATERS ===
                    float mediumCraters = 0.0;
                    mediumCraters += crater(pos, vec3(1.0, 1.5, 1.5), 0.5, 0.18);
                    mediumCraters += crater(pos, vec3(-0.5, -1.0, 2.0), 0.45, 0.15);
                    mediumCraters += crater(pos, vec3(2.0, -0.5, -1.0), 0.55, 0.17);
                    mediumCraters += crater(pos, vec3(-1.5, 0.5, -1.5), 0.48, 0.16);
                    mediumCraters += crater(pos, vec3(0.8, -1.5, -1.2), 0.42, 0.14);
                    mediumCraters += crater(pos, vec3(-0.3, 2.0, 1.0), 0.52, 0.18);
                    
                    // === SMALL CRATERS (detail) ===
                    float smallCraters = 0.0;
                    smallCraters += smallCrater(pos, vec3(1.2, 0.3, 2.0), 0.25);
                    smallCraters += smallCrater(pos, vec3(-0.8, 1.2, 1.8), 0.22);
                    smallCraters += smallCrater(pos, vec3(0.5, -0.8, 2.2), 0.2);
                    smallCraters += smallCrater(pos, vec3(-1.0, -0.3, 2.0), 0.23);
                    smallCraters += smallCrater(pos, vec3(1.5, 1.0, 1.5), 0.18);
                    smallCraters += smallCrater(pos, vec3(-0.5, 0.8, 2.1), 0.21);
                    smallCraters += smallCrater(pos, vec3(0.2, -1.2, 1.9), 0.19);
                    smallCraters += smallCrater(pos, vec3(-1.3, -1.0, 1.6), 0.24);
                    
                    // Surface roughness at different scales
                    float roughness = fbm3D(pos * 4.0) * 0.12;
                    float fineDetail = fbm3D(pos * 10.0) * 0.06;
                    float microDetail = fbm3D(pos * 25.0) * 0.03;
                    
                    // Combine all crater effects
                    float totalCraters = majorCraters + mediumCraters - smallCraters;
                    float totalSurface = roughness + fineDetail + microDetail + totalCraters;
                    
                    // Apply surface detail to color
                    vec3 moonColor = baseColor + totalSurface * vec3(0.15, 0.14, 0.13);
                    
                    // Darken crater floors
                    float craterDepth = max(0.0, -totalCraters * 2.0);
                    moonColor = mix(moonColor, craterFloor, craterDepth * 0.6);
                    
                    // === LIGHTING ===
                    // Side lighting to reveal crater topology (not just backlight)
                    vec3 sideLight = normalize(vec3(0.6, 0.3, 0.5)); // Light from upper right
                    float sideLightIntensity = max(0.0, dot(vNormal, sideLight));
                    
                    // Backlight from sun (behind moon during eclipse)
                    vec3 sunDir = normalize(vec3(-0.2 * (1.0 - uEclipseProgress), 0.0, -1.0));
                    float backLight = max(0.0, dot(vNormal, sunDir)) * 0.3;
                    
                    // Combined lighting with ambient
                    float ambient = 0.15;
                    float lighting = ambient + sideLightIntensity * 0.5 + backLight;
                    
                    // When not in eclipse, show more of the lit side
                    lighting = mix(lighting, ambient + sideLightIntensity * 0.6, 1.0 - uEclipseProgress);
                    
                    vec3 finalColor = moonColor * lighting;
                    
                    // Corona backlight rim - intensifies during eclipse
                    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 3.0);
                    float rimStrength = 0.15 + uEclipseProgress * 0.45;
                    vec3 rimColor = vec3(1.0, 0.55, 0.2) * fresnel * rimStrength;
                    
                    // Secondary soft rim (atmosphere-like scatter)
                    float rimSoft = pow(1.0 - abs(dot(vNormal, viewDir)), 1.5);
                    vec3 atmosphereRim = vec3(0.9, 0.45, 0.15) * rimSoft * 0.08 * (0.4 + uEclipseProgress * 0.6);
                    
                    finalColor += rimColor + atmosphereRim;
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
        });

        this.moon = new THREE.Mesh(geometry, material);
        // Start moon off to the right, it will drift in
        this.moon.position.set(this.moonStartX, 0, 50); // In front of sun
        this.moon.renderOrder = 100;
        this.scene.add(this.moon);

        console.log('[SolarEclipse] 3D Moon with crater texture created - will drift into eclipse position');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Corona Particles - 3D particles pulsing outward from sun
    // ─────────────────────────────────────────────────────────────────────────

    createCoronaParticles() {
        const particleCount = this.qualityPreset.coronaParticles;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const velocities = new Float32Array(particleCount * 3);
        const lifetimes = new Float32Array(particleCount);

        const coronaColors = [
            new THREE.Color(0xffdd77),
            new THREE.Color(0xffaa44),
            new THREE.Color(0xff7722),
            new THREE.Color(0xffcc55),
            new THREE.Color(0xffbb33),
        ];

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Spherical distribution around sun edge
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 310 + Math.random() * 100;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 80; // Center on sun

            // Outward velocity in 3D
            const speed = 0.2 + Math.random() * 0.5;
            velocities[i3] = Math.sin(phi) * Math.cos(theta) * speed;
            velocities[i3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
            velocities[i3 + 2] = Math.cos(phi) * speed;

            const color = coronaColors[Math.floor(Math.random() * coronaColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 2 + Math.random() * 5;
            lifetimes[i] = Math.random(); // Phase offset
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));

        const material = new THREE.PointsMaterial({
            size: 5,
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.coronaParticles = new THREE.Points(geometry, material);
        this.coronaParticles.userData.basePositions = positions.slice();
        this.scene.add(this.coronaParticles);

        console.log('[SolarEclipse] 3D Corona particles created:', particleCount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Flare Particles - 3D particles erupting from sun surface
    // ─────────────────────────────────────────────────────────────────────────

    createFlareParticles() {
        const particleCount = this.qualityPreset.flareParticles;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const data = new Float32Array(particleCount * 4); // angle, radius, speed, phase

        const flareColors = [
            new THREE.Color(0xffcc44),
            new THREE.Color(0xff8833),
            new THREE.Color(0xff6622),
            new THREE.Color(0xffdd66),
        ];

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            const i4 = i * 4;

            // Initial position on sun surface
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 320;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 80;

            // Store parameters for animation
            data[i4] = theta;
            data[i4 + 1] = phi;
            data[i4 + 2] = 0.3 + Math.random() * 0.8; // Speed
            data[i4 + 3] = Math.random() * Math.PI * 2; // Phase

            const color = flareColors[Math.floor(Math.random() * flareColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 3 + Math.random() * 6;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('data', new THREE.BufferAttribute(data, 4));

        const material = new THREE.PointsMaterial({
            size: 6,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.flareParticles = new THREE.Points(geometry, material);
        this.scene.add(this.flareParticles);

        console.log('[SolarEclipse] 3D Flare particles created:', particleCount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Meteor Field - Orbiting debris for depth
    // ─────────────────────────────────────────────────────────────────────────

    createMeteorField() {
        const count = this.qualityPreset.meteorCount;

        // Dark rock material
        const material = new THREE.MeshStandardMaterial({
            color: 0x151515,
            roughness: 0.9,
            metalness: 0.1,
            flatShading: true,
            side: THREE.DoubleSide,
        });

        // Pre-generate geometry variations
        const geometries = [];
        for (let i = 0; i < 40; i++) {
            const size = 4 + Math.random() * 12;
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

            // Orbital distribution around the moon (moon radius is 320, so stay outside)
            const angle = Math.random() * Math.PI * 2;
            const radius = 420 + Math.random() * 230; // 420-650, safely outside moon (320 radius)

            // Initial position (will be offset by moon position in animation)
            mesh.position.x = Math.cos(angle) * radius;
            mesh.position.y = (Math.random() - 0.5) * 150; // Tighter vertical spread
            mesh.position.z = Math.sin(angle) * radius * 0.6;

            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

            this.meteors.push({
                mesh,
                angle,
                radius,
                speed: (Math.random() * 0.08 + 0.03) * 0.01 * (Math.random() > 0.5 ? 1 : -1),
                yBase: (Math.random() - 0.5) * 180, // Store relative Y offset
                yOffset: Math.random() * Math.PI * 2,
                rotationSpeed: {
                    x: (Math.random() - 0.5) * 0.006,
                    y: (Math.random() - 0.5) * 0.006,
                    z: (Math.random() - 0.5) * 0.006,
                },
            });

            this.scene.add(mesh);
        }

        console.log('[SolarEclipse] Meteor field created (orbiting moon):', count);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ambient Particles - Floating 3D dust for depth
    // ─────────────────────────────────────────────────────────────────────────

    createAmbientParticles() {
        const particleCount = this.qualityPreset.ambientParticles;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const driftData = new Float32Array(particleCount * 3);

        const particleColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xffddaa),
            new THREE.Color(0xaaddff),
            new THREE.Color(0xffccaa),
            new THREE.Color(0xddddff),
        ];

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;

            // Spread throughout visible 3D space
            positions[i3] = (Math.random() - 0.5) * 5000;
            positions[i3 + 1] = (Math.random() - 0.5) * 2500;
            positions[i3 + 2] = (Math.random() - 0.5) * 3000 - 500;

            const color = particleColors[Math.floor(Math.random() * particleColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1 + Math.random() * 2.5;

            // Drift parameters
            driftData[i3] = Math.random() * Math.PI * 2; // Phase
            driftData[i3 + 1] = 0.2 + Math.random() * 0.5; // Speed
            driftData[i3 + 2] = 10 + Math.random() * 30; // Amplitude
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('drift', new THREE.BufferAttribute(driftData, 3));

        const material = new THREE.PointsMaterial({
            size: 2.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });

        this.ambientParticles = new THREE.Points(geometry, material);
        this.ambientParticles.userData.basePositions = positions.slice();
        this.scene.add(this.ambientParticles);

        console.log('[SolarEclipse] Ambient particles created:', particleCount);
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
            0.65,
        );
        this.composer.addPass(this.bloomPass);

        const vignettePass = new ShaderPass(VignetteShader);
        vignettePass.uniforms.darkness.value = 0.55;
        vignettePass.uniforms.offset.value = 1.25;
        this.composer.addPass(vignettePass);
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
    // Gameplay Effects
    // ─────────────────────────────────────────────────────────────────────────

    onLineClear(lineCount) {
        this.coronaPulseIntensity = Math.min(0.6 + lineCount * 0.25, 1.2);
        this.bloomPulseIntensity = Math.min(0.35 + lineCount * 0.15, 0.9);
        this.sunPulse = Math.min(0.3 + lineCount * 0.2, 0.8);
        this.flareIntensity = Math.min(1.6 + lineCount * 0.25, 2.8);

        const starCount = Math.min(lineCount + 1, 5);
        for (let i = 0; i < starCount; i++) {
            setTimeout(() => this.createShootingStar(), i * 100);
        }
    }

    onCombo(comboCount) {
        this.coronaPulseIntensity = Math.min(0.7 + comboCount * 0.15, 1.3);
        this.bloomPulseIntensity = Math.min(0.45 + comboCount * 0.1, 1.0);
        this.starTwinkleIntensity = Math.min(0.5 + comboCount * 0.15, 1.0);
        this.sunPulse = Math.min(0.4 + comboCount * 0.15, 0.9);

        if (comboCount >= 3) {
            const extraStars = Math.min(comboCount - 1, 6);
            for (let i = 0; i < extraStars; i++) {
                setTimeout(() => this.createShootingStar(), i * 120);
            }
        }
    }

    onPieceLock() {
        if (Math.random() < 0.35) {
            this.coronaPulseIntensity = Math.max(this.coronaPulseIntensity, 0.2);
            this.sunPulse = Math.max(this.sunPulse, 0.15);
        }
    }

    createShootingStar() {
        const geometry = new THREE.CylinderGeometry(0, 4, 120, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
        });

        const star = new THREE.Mesh(geometry, material);

        const side = Math.random();
        if (side < 0.5) {
            star.position.set(-2500, (Math.random() - 0.5) * 1800, -800 + Math.random() * 600);
            star.userData.velocity = { x: 45 + Math.random() * 20, y: -6 + Math.random() * 12, z: 5 };
        } else {
            star.position.set(2500, (Math.random() - 0.5) * 1800, -800 + Math.random() * 600);
            star.userData.velocity = { x: -(45 + Math.random() * 20), y: -6 + Math.random() * 12, z: 5 };
        }

        star.rotation.z = Math.atan2(star.userData.velocity.y, star.userData.velocity.x) - Math.PI / 2;
        star.userData.life = 1.0;
        this.scene.add(star);
        this.shootingStars.push(star);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            this.time += 0.01;
            const delta = this.clock.getDelta();

            // === MOON DRIFT ANIMATION - Continuous Loop ===
            if (this.moon) {
                // Calculate speed modifier - MUCH slower at center (eclipse), faster at edges
                // At progress 0.5 (center/eclipse), speed is only 0.05x base. At edges, speed is 1x base.
                const distFromCenter = Math.abs(this.moonDriftProgress - 0.5) * 2; // 0 at center, 1 at edges
                // Use exponential curve for more dramatic slowdown near sun
                const easedDist = Math.pow(distFromCenter, 0.6); // Lower exponent = slower zone extends longer
                const speedMultiplier = 0.05 + easedDist * 0.95; // 0.05 to 1.0 (5% to 100%)
                const currentSpeed = this.moonDriftBaseSpeed * speedMultiplier;

                this.moonDriftProgress += currentSpeed;

                // Loop when moon goes off-screen to the left
                if (this.moonDriftProgress >= 1.0) {
                    this.moonDriftProgress = 0;
                }

                // Calculate moon position - linear from right to left
                const moonX = this.moonStartX + (this.moonEndX - this.moonStartX) * this.moonDriftProgress;

                // Gentle arc - highest at center (eclipse)
                const arcHeight = Math.sin(this.moonDriftProgress * Math.PI) * 25;
                const moonY = arcHeight;

                // Slight z-depth variation for more 3D feel
                const zVariation = Math.sin(this.moonDriftProgress * Math.PI) * 20;

                this.moon.position.x = moonX;
                this.moon.position.y = moonY;
                this.moon.position.z = 50 - zVariation; // Comes slightly closer at eclipse

                // Slow rotation as it drifts
                this.moon.rotation.y += 0.00015;
            }

            // Update sun shader
            if (this.sun?.material?.uniforms) {
                this.sun.material.uniforms.uTime.value = this.time;
                this.sun.material.uniforms.uIntensity.value = 1.0 + this.coronaPulseIntensity * 0.25;
                this.sun.material.uniforms.uPulse.value = this.sunPulse;

                // Sun also rotates slowly
                this.sun.rotation.y += 0.0001;
            }

            // Update moon shader with eclipse progress
            if (this.moon?.material?.uniforms) {
                this.moon.material.uniforms.uTime.value = this.time;
                // Eclipse intensity peaks at progress 0.5 (center), 0 at edges
                const eclipseIntensity = 1.0 - Math.abs(this.moonDriftProgress - 0.5) * 2;
                this.moon.material.uniforms.uEclipseProgress.value = Math.max(0, eclipseIntensity);
            }

            // Animate sun glow layers
            this.sunGlowLayers.forEach((glow, i) => {
                const pulse = 1 + Math.sin(this.time * (0.5 + i * 0.2)) * 0.03;
                glow.scale.set(pulse, pulse, 1);
                glow.material.opacity = glow.userData.baseOpacity || glow.material.opacity;
                glow.material.opacity *= (0.95 + Math.sin(this.time * 0.8 + i) * 0.05);
            });

            // Store base opacity on first run
            if (this.time < 0.02) {
                this.sunGlowLayers.forEach(glow => {
                    glow.userData.baseOpacity = glow.material.opacity;
                });
            }

            // Animate corona particles - pulsing outward in 3D
            if (this.coronaParticles) {
                const positions = this.coronaParticles.geometry.attributes.position.array;
                const base = this.coronaParticles.userData.basePositions;
                const velocities = this.coronaParticles.geometry.attributes.velocity.array;
                const lifetimes = this.coronaParticles.geometry.attributes.lifetime.array;

                for (let i = 0; i < positions.length / 3; i++) {
                    const i3 = i * 3;
                    const phase = (this.time * 2 + lifetimes[i] * Math.PI * 2) % (Math.PI * 2);
                    const pulse = (Math.sin(phase) * 0.5 + 0.5);
                    const expansion = pulse * 80 * (1 + this.coronaPulseIntensity * 0.5);

                    positions[i3] = base[i3] + velocities[i3] * expansion;
                    positions[i3 + 1] = base[i3 + 1] + velocities[i3 + 1] * expansion;
                    positions[i3 + 2] = base[i3 + 2] + velocities[i3 + 2] * expansion;
                }

                this.coronaParticles.geometry.attributes.position.needsUpdate = true;
                this.coronaParticles.material.opacity = 0.7 + this.coronaPulseIntensity * 0.2 + Math.sin(this.time * 3) * 0.08;
            }

            // Animate flare particles - erupting from sun
            if (this.flareParticles) {
                const positions = this.flareParticles.geometry.attributes.position.array;
                const data = this.flareParticles.geometry.attributes.data.array;

                for (let i = 0; i < positions.length / 3; i++) {
                    const i3 = i * 3;
                    const i4 = i * 4;

                    const theta = data[i4];
                    const phi = data[i4 + 1];
                    const speed = data[i4 + 2];
                    const phase = data[i4 + 3];

                    // Pulsing eruption
                    const eruption = (Math.sin(this.time * speed + phase) * 0.5 + 0.5);
                    const flareRadius = 320 + eruption * 200 * this.flareIntensity;

                    positions[i3] = flareRadius * Math.sin(phi) * Math.cos(theta);
                    positions[i3 + 1] = flareRadius * Math.sin(phi) * Math.sin(theta);
                    positions[i3 + 2] = flareRadius * Math.cos(phi) - 80;
                }

                this.flareParticles.geometry.attributes.position.needsUpdate = true;
                this.flareParticles.material.opacity = 0.6 + this.coronaPulseIntensity * 0.3;
            }

            // Animate meteors - orbital motion around the MOON
            if (this.moon) {
                const moonPos = this.moon.position;
                const moonRadius = 320; // Moon's actual radius
                const minDistance = moonRadius + 80; // Minimum safe distance from moon center

                this.meteors.forEach((meteor) => {
                    meteor.angle += meteor.speed;

                    // Calculate orbital position (circular, not elliptical)
                    const orbitX = Math.cos(meteor.angle) * meteor.radius;
                    const orbitZ = Math.sin(meteor.angle) * meteor.radius;
                    const orbitY = meteor.yBase + Math.sin(this.time + meteor.yOffset) * 10;

                    // Position relative to moon
                    let newX = moonPos.x + orbitX;
                    let newY = moonPos.y + orbitY;
                    let newZ = moonPos.z + orbitZ;

                    // Safety check: ensure meteor stays outside moon sphere
                    const dx = newX - moonPos.x;
                    const dy = newY - moonPos.y;
                    const dz = newZ - moonPos.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (dist < minDistance) {
                        // Push meteor outward if too close
                        const scale = minDistance / dist;
                        newX = moonPos.x + dx * scale;
                        newY = moonPos.y + dy * scale;
                        newZ = moonPos.z + dz * scale;
                    }

                    meteor.mesh.position.x = newX;
                    meteor.mesh.position.y = newY;
                    meteor.mesh.position.z = newZ;

                    meteor.mesh.rotation.x += meteor.rotationSpeed.x;
                    meteor.mesh.rotation.y += meteor.rotationSpeed.y;
                    meteor.mesh.rotation.z += meteor.rotationSpeed.z;
                });
            }

            // Animate ambient particles - gentle 3D drift
            if (this.ambientParticles) {
                const positions = this.ambientParticles.geometry.attributes.position.array;
                const base = this.ambientParticles.userData.basePositions;
                const drift = this.ambientParticles.geometry.attributes.drift.array;

                for (let i = 0; i < positions.length / 3; i++) {
                    const i3 = i * 3;
                    const phase = drift[i3];
                    const speed = drift[i3 + 1];
                    const amplitude = drift[i3 + 2];

                    positions[i3] = base[i3] + Math.sin(this.time * speed + phase) * amplitude;
                    positions[i3 + 1] = base[i3 + 1] + Math.cos(this.time * speed * 0.7 + phase) * amplitude * 0.5;
                    positions[i3 + 2] = base[i3 + 2] + Math.sin(this.time * speed * 0.5 + phase * 2) * amplitude * 0.3;
                }

                this.ambientParticles.geometry.attributes.position.needsUpdate = true;
            }

            // Nebula clouds drift
            this.nebulaClouds.forEach((cloud, i) => {
                cloud.rotation.z += 0.00008 * (i % 2 === 0 ? 1 : -1);
            });

            // Starfield twinkling
            if (this.starfield?.material) {
                if (this.starTwinkleIntensity > 0) {
                    this.starTwinkleIntensity *= 0.95;
                    if (this.starTwinkleIntensity < 0.01) this.starTwinkleIntensity = 0;
                }
                this.starfield.material.opacity = 0.75 + this.starTwinkleIntensity * 0.25;
            }

            // Decay effect intensities
            if (this.coronaPulseIntensity > 0) {
                this.coronaPulseIntensity *= 0.93;
                if (this.coronaPulseIntensity < 0.01) this.coronaPulseIntensity = 0;
            }

            if (this.bloomPulseIntensity > 0) {
                this.bloomPulseIntensity *= 0.94;
                if (this.bloomPulseIntensity < 0.005) this.bloomPulseIntensity = 0;
            }

            if (this.sunPulse > 0) {
                this.sunPulse *= 0.92;
                if (this.sunPulse < 0.01) this.sunPulse = 0;
            }

            if (this.flareIntensity > 1.0) {
                this.flareIntensity *= 0.96;
                if (this.flareIntensity < 1.02) this.flareIntensity = 1.0;
            }

            // Update bloom
            if (this.bloomPass) {
                this.bloomPass.strength = this.qualityPreset.bloomStrength * (1 + this.bloomPulseIntensity);
            }

            // Animate shooting stars
            this.shootingStars = this.shootingStars.filter((star) => {
                star.position.x += star.userData.velocity.x;
                star.position.y += star.userData.velocity.y;
                star.position.z += star.userData.velocity.z;
                star.userData.life -= 0.012;
                star.material.opacity = star.userData.life;

                if (star.userData.life <= 0) {
                    this.scene.remove(star);
                    star.geometry.dispose();
                    star.material.dispose();
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

        this.shootingStars.forEach((star) => {
            this.scene?.remove(star);
            star.geometry?.dispose();
            star.material?.dispose();
        });
        this.shootingStars = [];

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.sun = null;
        this.moon = null;
        this.coronaParticles = null;
        this.flareParticles = null;
        this.starfield = null;
        this.nebulaClouds = [];
        this.meteors = [];
        this.ambientParticles = null;
        this.sunGlowLayers = [];

        // Reset moon drift state for next time
        this.moonDriftProgress = 0;

        super.cleanup();
    }
}
