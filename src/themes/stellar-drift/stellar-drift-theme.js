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

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

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
        this.createNebulaClouds();   // Colorful nebula
        // this.createBackground();   // REMOVED: Was causing foreground artifact issues
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

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setPixelRatio(1);
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
        const starCount = 2000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xffeedd),
            new THREE.Color(0xddddff),
            new THREE.Color(0xffdddd),
        ];

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            // Spread stars across a large sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            // Push stars VERY far back - all behind planet (z < -500)
            // Max z = 4500 - 5000 = -500, Min z = -4500 - 5000 = -9500
            const radius = 2500 + Math.random() * 2000;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = (radius * Math.cos(phi)) - 5000; // Pushed WAY back

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1 + Math.random() * 3;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 3,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        console.log('[StellarDrift] Starfield created with', starCount, 'stars');
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
    // Background (Two scrolling planes at z=-520, like Andromeda)
    // ─────────────────────────────────────────────────────────────────────────

    createBackground() {
        const scale = 3200;
        const planeWidth = scale * 4;  // 12800
        const planeHeight = scale;     // 3200

        // Create procedural starfield texture
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Deep space gradient with nebula colors - More Colorful
        const gradient = ctx.createLinearGradient(0, 0, 1024, 256);
        gradient.addColorStop(0, '#2a0835');   // Deep Purple
        gradient.addColorStop(0.3, '#10204a'); // Deep Blue
        gradient.addColorStop(0.5, '#0a1520'); // Space Dark
        gradient.addColorStop(0.7, '#15303a'); // Deep Teal
        gradient.addColorStop(1, '#2a0835');   // Deep Purple
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1024, 256);

        // NOTE: Removed painted stars - the 3D starfield handles all stars now
        // The painted stars on this scrolling layer caused foreground artifacts

        // Pink/magenta/Teal nebula clouds - VIBRANT
        for (let i = 0; i < 8; i++) { // More clouds
            const x = Math.random() * 1024;
            const y = Math.random() * 256;
            const radius = 100 + Math.random() * 100;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);

            // Random vibrant colors
            const hue = Math.random() > 0.5 ? 320 + Math.random() * 40 : 180 + Math.random() * 40;

            grad.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.2)`);
            grad.addColorStop(0.5, `hsla(${hue}, 70%, 40%, 0.1)`);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1024, 256);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff,
            transparent: true,
            opacity: 0.25,     // Reduced from 0.8 to remove "blurry window" look
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
        });

        // Two planes for seamless horizontal scrolling
        const randomOffset = Math.random() * planeWidth * 0.6;

        for (let i = 0; i < 2; i++) {
            const plane = new THREE.Mesh(geometry, material.clone());
            plane.position.z = -800;  // Push further back
            plane.position.x = (i === 0 ? -planeWidth * 0.5 : planeWidth * 0.5) + randomOffset;
            plane.userData.speed = 0.3;  // Slower
            plane.userData.width = planeWidth;
            this.scene.add(plane);
            this.backgroundPlanes.push(plane);
        }

        console.log('[StellarDrift] Background at z=-520');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Planet - Pink/Salmon Gas Giant with Flowing Bands
    // ─────────────────────────────────────────────────────────────────────────

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
                    
                    // Color Palette: Mars-like (rusty red/orange)
                    vec3 white = vec3(1.0, 0.95, 0.9);
                    vec3 dustyOrange = vec3(0.9, 0.6, 0.4);    // Bright dusty orange
                    vec3 rustRed = vec3(0.75, 0.35, 0.25);     // Mars rust red
                    vec3 terracotta = vec3(0.6, 0.25, 0.15);   // Deep terracotta
                    vec3 darkRust = vec3(0.35, 0.15, 0.1);     // Dark shadow rust
                    
                    // Mix colors based on bands
                    vec3 bandColor;
                    if (bands < 0.3) {
                        bandColor = mix(darkRust, terracotta, bands * 3.3);
                    } else if (bands < 0.6) {
                        bandColor = mix(terracotta, rustRed, (bands - 0.3) * 3.3);
                    } else {
                        bandColor = mix(rustRed, dustyOrange, (bands - 0.6) * 2.5);
                    }
                    
                    // Apply storm spots - darker areas that are visible during rotation
                    vec3 stormColor = darkRust * 0.7; // Dark storm centers
                    bandColor = mix(bandColor, stormColor, storms);
                    
                    // REALISTIC MARS-LIKE LIGHTING
                    // Light direction from upper-right
                    vec3 lightDir = normalize(vec3(0.7, 0.3, 0.6));
                    vec3 viewDir = normalize(vViewPosition);
                    
                    // Main directional shadow (like the reference photo)
                    float NdotL = dot(vNormal, lightDir);
                    float shadow = smoothstep(-0.1, 0.3, NdotL); // Soft terminator line
                    
                    // Apply deep shadow to unlit side
                    vec3 shadowColor = bandColor * 0.15; // Very dark shadow
                    vec3 litColor = bandColor;
                    vec3 finalColor = mix(shadowColor, litColor, shadow);
                    
                    // Add subtle ambient light to shadow side (from nebula)
                    float ambient = 0.08;
                    finalColor += bandColor * ambient * (1.0 - shadow);
                    
                    // Rim light on the dark edge (subtle backlight)
                    float rimLight = pow(1.0 - abs(dot(vNormal, viewDir)), 3.0);
                    rimLight *= (1.0 - shadow) * 0.3; // Only on shadow side
                    finalColor += vec3(0.4, 0.2, 0.15) * rimLight;
                    
                    // Specular highlight on lit side
                    vec3 halfDir = normalize(lightDir + viewDir);
                    float spec = pow(max(dot(vNormal, halfDir), 0.0), 20.0) * shadow;
                    finalColor += vec3(1.0, 0.9, 0.8) * spec * 0.15;
                    
                    // Very subtle atmospheric haze at edges
                    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.5);
                    vec3 atmosphereColor = vec3(0.9, 0.5, 0.3);
                    finalColor += atmosphereColor * fresnel * shadow * 0.2;
                    
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

        // Dark material with solid appearance
        const material = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            roughness: 0.9,
            metalness: 0.1,
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
            const speed = -(Math.random() * 0.2 + 0.1) * 0.005; // Negative for Opposite Rotation

            this.meteors.push({
                mesh,
                angle,
                radius,
                speed,
                yBase: mesh.position.y,
                // Rotation (tumbling)
                rotationSpeed: {
                    x: Math.random() * 0.005 + 0.005,
                    y: Math.random() * 0.005 + 0.005,
                    z: Math.random() * 0.005 + 0.005,
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

        // 3. PLANET GLOW SURGE - Set intensity based on combo (decays smoothly)
        this.glowSurgeIntensity = Math.min(comboCount * 0.08, 0.5);

        // 4. BLOOM BOOST - Add to existing pulse intensity
        this.bloomPulseIntensity = Math.max(this.bloomPulseIntensity, comboCount * 0.1);

        // 5. STAR TWINKLE on combos too
        this.starTwinkleIntensity = Math.max(this.starTwinkleIntensity, 0.5 + comboCount * 0.1);
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
        const animate = () => {
            if (!this.isActive) return;

            this.time += 0.002;

            // Update planet shader
            if (this.planet?.material?.uniforms) {
                this.planet.material.uniforms.uTime.value = this.time;
            }

            // Rotate planet around its axis
            if (this.planet) {
                this.planet.rotation.y += 0.0001; // Ultra slow spin
            }

            // Scroll background (like Andromeda)
            this.backgroundPlanes.forEach((plane) => {
                plane.position.x += plane.userData.speed;
                if (plane.position.x > plane.userData.width * 0.5) {
                    plane.position.x -= plane.userData.width;
                } else if (plane.position.x < -plane.userData.width * 0.5) {
                    plane.position.x += plane.userData.width;
                }
            });

            // Move meteors (Rotate around planet)
            this.meteors.forEach((m) => {
                // Orbital rotation
                m.angle += m.speed;

                // Update position based on new angle
                m.mesh.position.x = Math.sin(m.angle) * m.radius;
                m.mesh.position.z = Math.cos(m.angle) * m.radius;

                // Add slight vertical wave movement
                m.mesh.position.y = m.yBase + Math.sin(m.angle * 2.0 + this.time) * 10;

                // Tumble rotation
                m.mesh.rotation.x -= m.rotationSpeed.x;
                m.mesh.rotation.y -= m.rotationSpeed.y;
                m.mesh.rotation.z -= m.rotationSpeed.z;
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

            // Starfield twinkling - EVENT DRIVEN (not automatic)
            // this.starTwinkleIntensity is set by triggerLockEffect and decays
            if (this.starfield && this.starfield.material) {
                // Decay the twinkle intensity over time
                if (this.starTwinkleIntensity > 0) {
                    this.starTwinkleIntensity *= 0.95; // Slower decay for smoothness
                    if (this.starTwinkleIntensity < 0.01) this.starTwinkleIntensity = 0;
                }
                // Base opacity + flash intensity
                this.starfield.material.opacity = 0.6 + this.starTwinkleIntensity * 0.4;
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

            // SMOOTH GLOW SURGE - Gradual planet glow decay
            if (this.glowSurgeIntensity > 0) {
                this.glowSurgeIntensity *= 0.96;
                if (this.glowSurgeIntensity < 0.01) this.glowSurgeIntensity = 0;
            }
            if (this.smallGlow) {
                const glowScale = 1 + this.glowSurgeIntensity;
                this.smallGlow.scale.set(glowScale, glowScale, 1);
            }
            if (this.bigGlow) {
                const bigScale = 1 + this.glowSurgeIntensity * 0.5;
                this.bigGlow.scale.set(bigScale, bigScale, 1);
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
