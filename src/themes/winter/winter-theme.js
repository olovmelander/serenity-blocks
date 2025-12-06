/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ❄️ WINTER WONDERLAND ❄️
 *  A 3D Winter Theme for Serenity Blocks using Three.js
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Stunning Multi-Layer Aurora Borealis with FBM Noise
 * - Glowing Moon with atmospheric halo
 * - GPU-accelerated 3D snow particle system with depth parallax
 * - "Storm" Logic: Wind streaks, Vortexes, and Hard turbulence
 * - Detailed Mountains and Post-processing
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { WINTER_TETROMINOS } from './winter-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createSnowflakeTexture() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(16, 16, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.translate(16, 16);
    for (let i = 0; i < 6; i++) {
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(4, 9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(-4, 9); ctx.stroke();
        ctx.rotate(Math.PI / 3);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        snowCount: 20000,
        iceBurstCount: 400,
        streakCount: 200,
        vortexCount: 300,
        mountainSegments: 128,
        auroraLayers: 4,     // Multi-layer aurora
        auroraSegments: 128,
        enableAurora: true,
        bloomStrength: 0.25,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        fogDensity: 0.0005,
    },
    Ultra: {
        snowCount: 15000,
        iceBurstCount: 300,
        streakCount: 150,
        vortexCount: 200,
        mountainSegments: 96,
        auroraLayers: 3,
        auroraSegments: 96,
        enableAurora: true,
        bloomStrength: 0.2,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        fogDensity: 0.0006,
    },
    High: {
        snowCount: 10000,
        iceBurstCount: 200,
        streakCount: 100,
        vortexCount: 150,
        mountainSegments: 64,
        auroraLayers: 2,
        auroraSegments: 64,
        enableAurora: true,
        bloomStrength: 0.18,
        bloomRadius: 0.4,
        enablePostProcessing: true,
        fogDensity: 0.0008,
    },
    Medium: {
        snowCount: 6000,
        iceBurstCount: 100,
        streakCount: 50,
        vortexCount: 100,
        mountainSegments: 48,
        auroraLayers: 1,
        auroraSegments: 48,
        enableAurora: true,
        bloomStrength: 0.15,
        bloomRadius: 0.3,
        enablePostProcessing: true,
        fogDensity: 0.001,
    },
    Low: {
        snowCount: 3000,
        iceBurstCount: 50,
        streakCount: 20,
        vortexCount: 30,
        mountainSegments: 32,
        auroraLayers: 1,
        auroraSegments: 32,
        enableAurora: true, // Simplified
        bloomStrength: 0.1,
        bloomRadius: 0.2,
        enablePostProcessing: false,
        fogDensity: 0.0015,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// SHADERS
// ─────────────────────────────────────────────────────────────────────────────

// High-detail FBM Aurora Shader
const VolumetricAuroraShader = {
    uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1.0 },
        uColor1: { value: new THREE.Color(0x00ff99) }, // Emerald Green
        uColor2: { value: new THREE.Color(0x3366ff) }, // Royal Blue
        uColor3: { value: new THREE.Color(0x8800ff) }, // Purple
        uOpacity: { value: 0.6 },
        uSpeed: { value: 1.0 },
        uOffset: { value: 0.0 }, // Each layer gets an offset
    },
    vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
            vUv = uv;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uOpacity;
        uniform float uSpeed;
        uniform float uOffset;
        uniform vec3 uColor1; uniform vec3 uColor2; uniform vec3 uColor3;
        varying vec2 vUv;

        // Simplex/FBM Noise (Optimized)
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

        float snoise(vec2 v) {
            const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
            vec2 i  = floor(v + dot(v, C.yy));
            vec2 x0 = v - i + dot(i, C.xx);
            vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec4 x12 = x0.xyxy + C.xxzz;
            x12.xy -= i1;
            i = mod289(i);
            vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
            vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
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

        void main() {
            vec2 uv = vUv;
            
            // Introduce "Curtain" distortion
            // Use time and X to flow sideways, but noise Y acts as vertical flame
            float t = uTime * 0.15 * uSpeed + uOffset;
            
            // FBM-like layering
            float n1 = snoise(vec2(uv.x * 3.0 + t, uv.y * 1.5));
            float n2 = snoise(vec2(uv.x * 6.0 - t * 0.5, uv.y * 5.0 + t * 0.2));
            float n3 = snoise(vec2(uv.x * 12.0 + t * 0.8, uv.y * 8.0));
            
            // Combined noise shape
            float noise = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
            
            // Vertical fade (bottom hard fade, top soft fade)
            float vFade = smoothstep(0.0, 0.15, uv.y) * smoothstep(1.0, 0.4, uv.y);
            
            // Intensity mask (Curtains)
            // A vertical sine wave creates the "folds" of the aurora curtain
            float folds = sin(uv.x * 8.0 + noise * 3.0 + t) * 0.5 + 0.5;
            folds = pow(folds, 2.0); // Sharpen folds

            float intensity = folds * vFade * (0.6 + noise * 0.4);
            
            // Color gradient
            // Bottom (0.0) -> Color1 (Green)
            // Mid    (0.5) -> Color2 (Blue)
            // Top    (1.0) -> Color3 (Purple)
            float hue = uv.y + noise * 0.2;
            vec3 color = mix(uColor1, uColor2, smoothstep(0.0, 0.5, hue));
            color = mix(color, uColor3, smoothstep(0.5, 1.0, hue));

            // Boost glow
            color *= 1.5 * uIntensity;

            gl_FragColor = vec4(color, intensity * uOpacity * uIntensity);
        }
    `,
};

// Physical Glowing Moon Shader
const MoonShader = {
    uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xddeeff) }, // Cold white/blue
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
        uniform vec3 uColor;
        varying vec3 vNormal;
        void main() {
            // Simple rim lighting + internal glow
            float intensity = pow(0.7 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
            // Soft white center
            vec3 col = uColor + vec3(0.2) * (1.0 - intensity);
            // Halo glow
            float halo = 0.5 + 0.5 * sin(vNormal.y * 10.0); // Fake detail
            gl_FragColor = vec4(col, 1.0);
        }
    `,
};

// Atmosphere/Vignette
const VignetteShader = {
    uniforms: { tDiffuse: { value: null }, darkness: { value: 0.6 }, offset: { value: 1.0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float darkness; uniform float offset; varying vec2 vUv;
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float vig = smoothstep(offset, offset - 0.7, dist);
            
            // Cold blue grading
            vec3 col = texel.rgb;
            col.b *= 1.1; // Cold boost
            col.r *= 0.95; 
            
            col = mix(col * (1.0 - darkness), col, vig);
            gl_FragColor = vec4(col, texel.a);
        }
    `,
};

const SnowShader = {
    uniforms: {
        uTime: { value: 0 }, uWindForce: { value: 0 }, uGustIntensity: { value: 0 },
        uComboMultiplier: { value: 1.0 }, uFlashIntensity: { value: 0 },
        uTexture: { value: null }, uUseTexture: { value: 0.0 },
    },
    vertexShader: `
        attribute float size; attribute float depth; attribute float phase; attribute float wobbleSpeed; attribute float rotationSpeed;
        uniform float uTime; uniform float uWindForce; uniform float uGustIntensity;
        varying float vDepth; varying float vPhase; varying float vRotation;
        void main() {
            vDepth = depth; vPhase = phase;
            vec3 pos = position;
            float windX = uWindForce * (1.0 + depth); 
            float turbulenceWave = sin(pos.y * 0.05 + uTime * 4.0);
            float hardTurbulence = sign(turbulenceWave) * pow(abs(turbulenceWave), 0.5);
            float turbulence = hardTurbulence * uGustIntensity * 25.0;
            float spiral = sin(uTime * wobbleSpeed + phase) * (2.0 + uGustIntensity * 5.0);
            pos.x += windX + turbulence + spiral;
            pos.z += cos(uTime * wobbleSpeed * 0.5) * 2.0; 
            pos.z -= uWindForce * 0.1;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            float depthScale = 0.5 + depth * 0.5;
            gl_PointSize = size * depthScale * (600.0 / -mvPosition.z);
            vRotation = uTime * rotationSpeed + phase;
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform float uTime; uniform float uFlashIntensity; uniform sampler2D uTexture; uniform float uUseTexture;
        varying float vDepth; varying float vPhase; varying float vRotation;
        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            float s = sin(vRotation); float c = cos(vRotation);
            vec2 rotatedCoord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c) + 0.5;
            vec4 texColor = vec4(1.0);
            if (uUseTexture > 0.5) texColor = texture2D(uTexture, rotatedCoord);
            else { float dist = length(coord); float alpha = 1.0 - smoothstep(0.3, 0.5, dist); texColor = vec4(1.0, 1.0, 1.0, alpha); }
            float depthAlpha = (0.2 + vDepth * 0.6) * 0.8; 
            float twinkle = 0.85 + 0.15 * sin(uTime * 3.0 + vPhase * 10.0);
            float flash = 1.0 + clamp(uFlashIntensity, 0.0, 1.0);
            gl_FragColor = vec4(texColor.rgb * flash, texColor.a * depthAlpha * twinkle);
        }
    `,
};

const StreakShader = {
    uniforms: { uTime: { value: 0 }, uWindForce: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: `
        attribute float length; attribute float speed; attribute float offset;
        uniform float uTime; uniform float uWindForce;
        void main() {
            vec3 pos = position;
            float dist = (uTime * speed * (1.0 + abs(uWindForce) * 0.1));
            pos.x += dist * sign(uWindForce); 
            if (pos.x > 500.0) pos.x -= 1000.0; if (pos.x < -500.0) pos.x += 1000.0;
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            float stretch = 1.0 + abs(uWindForce) * 0.5;
            gl_PointSize = length * stretch * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform float uOpacity;
        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            if (abs(coord.y) > 0.1) discard;
            float alpha = smoothstep(0.0, 1.0, 1.0 - abs(coord.x * 2.0));
            gl_FragColor = vec4(0.8, 0.9, 1.0, alpha * uOpacity);
        }
    `,
};

const VortexShader = {
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3(0, 0, 0) }, uIntensity: { value: 0.0 } },
    vertexShader: `
        attribute float angle; attribute float radius; attribute float speed; attribute float size;
        uniform float uTime; uniform vec3 uCenter;
        void main() {
            float currentAngle = angle + uTime * speed;
            vec3 pos = uCenter;
            pos.x += cos(currentAngle) * radius;
            pos.y += sin(currentAngle) * radius * 0.3; 
            pos.z += (sin(currentAngle * 2.0) * 20.0);
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = size * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform float uIntensity;
        void main() {
            vec2 coord = gl_PointCoord - 0.5; if (length(coord) > 0.5) discard;
            gl_FragColor = vec4(1.0, 1.0, 1.0, (1.0 - length(coord) * 2.0) * uIntensity);
        }
    `,
};

const IceBurstShader = {
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
        attribute float size; attribute float life; attribute vec3 velocity;
        varying float vLife; varying vec3 vColor;
        void main() {
            vLife = life;
            float colorVar = sin(life * 10.0);
            vColor = mix(vec3(0.5, 0.9, 1.0), vec3(0.9, 0.95, 1.0), colorVar * 0.5 + 0.5);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * life * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying float vLife; varying vec3 vColor;
        void main() {
            float dist = length(gl_PointCoord - 0.5);
            if (dist > 0.5) discard;
            float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * vLife;
            gl_FragColor = vec4(vColor, alpha);
        }
    `,
};

const FrozenLightningShader = {
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 1.0 } },
    vertexShader: `
        attribute float alpha; varying float vAlpha;
        void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
        uniform float uTime; uniform float uIntensity; varying float vAlpha;
        void main() {
            float pulse = 0.8 + 0.2 * sin(uTime * 15.0);
            vec3 color = mix(vec3(0.4, 0.7, 1.0), vec3(0.8, 0.95, 1.0), pulse);
            gl_FragColor = vec4(color, vAlpha * uIntensity);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class WinterTheme extends BaseTheme {
    constructor() {
        super('winter');
        this.renderer = null; this.scene = null; this.camera = null; this.composer = null;

        this.snowParticles = null;
        this.auroraLayers = []; // Array of aurora meshes
        this.mountains = [];
        this.moon = null;
        this.iceBurstParticles = null;
        this.frozenLightning = [];
        this.windStreaks = null;
        this.vortexSystems = [];

        this.snowflakeTexture = null;

        this.windForce = 0; this.targetWindForce = 0;
        this.gustIntensity = 0; this.gustDuration = 0;
        this.comboMultiplier = 1.0; this.comboDecay = 0;
        this.flashIntensity = 0;
        this.cameraShake = { x: 0, y: 0, intensity: 0 };

        this.comboWindTimer = 0; this.pendingComboCount = 0;
        this.clock = new THREE.Clock(); this.time = 0;

        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.iceBurstData = { positions: null, velocities: null, lives: null, sizes: null, active: [], nextIndex: 0 };

        console.log('[WinterTheme] Theme constructed');
    }

    getTetrominoConfig() { return WINTER_TETROMINOS; }

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
        if (typeof document === 'undefined') return;
        this.applyQualityPreset(this.getCurrentQualityLevel());
        this.snowflakeTexture = createSnowflakeTexture();

        const container = document.getElementById('winter-theme');
        if (!container) return;
        const oldCanvas = container.querySelector('#winter-canvas');
        if (oldCanvas) oldCanvas.style.display = 'none';

        this.initRenderer(container);
        this.createSkyBackground();
        this.createMoon(); // NEW
        this.createMountains();
        if (this.qualityPreset.enableAurora) this.createAuroraSystem(); // UPGRADED
        this.createSnowParticles();
        this.createIceBurstSystem();
        this.createWindStreaks();
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();
    }

    initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setClearColor(0x020408, 1); // Darker base
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = true;
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        // Rich Midnight Fog
        const fogColor = new THREE.Color(0x050a14);
        this.scene.fog = new THREE.FogExp2(fogColor, this.qualityPreset.fogDensity);
        this.scene.background = fogColor;

        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 8000);
        this.camera.position.set(0, 0, 100);
        this.camera.lookAt(0, 0, -500);

        this.scene.add(new THREE.AmbientLight(0x405070, 0.3));
        const moonLight = new THREE.DirectionalLight(0xaaccff, 0.8);
        moonLight.position.set(500, 1000, -800); // Aligned with Moon
        this.scene.add(moonLight);
    }

    createSkyBackground() {
        // Starfield is key for deep atmosphere
        const starCount = 5000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const phases = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const r = 4000 + Math.random() * 500;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = r * Math.cos(phi);

            // Prefer upper hemisphere
            if (positions[i3 + 1] < -500) positions[i3 + 1] *= -1;

            sizes[i] = 2.0 + Math.random() * 2.5;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                attribute float size; attribute float phase; varying float vPhase;
                void main() { vPhase = phase; gl_PointSize = size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: `
                uniform float uTime; varying float vPhase;
                void main() {
                    vec2 coord = gl_PointCoord - 0.5; if (length(coord) > 0.5) discard;
                    float twinkle = 0.5 + 0.5 * sin(uTime * 1.5 + vPhase * 10.0);
                    gl_FragColor = vec4(0.9, 0.95, 1.0, (1.0 - length(coord) * 2.0) * twinkle * 0.8);
                }
            `,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);

        // Backdrop gradient mesh
        const skyGeo = new THREE.SphereGeometry(4500, 32, 32);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                uTop: { value: new THREE.Color(0x000000) },
                uMid: { value: new THREE.Color(0x050a18) },
                uBot: { value: new THREE.Color(0x0f1b2d) }
            },
            vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
            fragmentShader: `
                uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; varying vec3 vPos;
                void main() {
                    float h = normalize(vPos).y;
                    vec3 col = mix(uMid, uTop, smoothstep(0.0, 1.0, h));
                    col = mix(uBot, col, smoothstep(-0.2, 0.2, h));
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    }

    createMoon() {
        const geometry = new THREE.SphereGeometry(150, 64, 64);
        const material = new THREE.ShaderMaterial({
            uniforms: MoonShader.uniforms,
            vertexShader: MoonShader.vertexShader,
            fragmentShader: MoonShader.fragmentShader,
        });
        this.moon = new THREE.Mesh(geometry, material);
        this.moon.position.set(500, 1000, -800);
        this.scene.add(this.moon);

        // Moon Glow sprite
        const spriteMat = new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(this.createGlowCanvas()),
            color: 0xaaddff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });
        const glow = new THREE.Sprite(spriteMat);
        glow.scale.set(600, 600, 1);
        this.moon.add(glow); // Attach to moon
    }

    createGlowCanvas() {
        if (typeof document === 'undefined') return null;
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
        return c;
    }

    createMountains() {
        const ranges = [
            { z: -1800, color: 0x060c15, height: 700, width: 5000, snowLine: 0.35 },
            { z: -1100, color: 0x091220, height: 450, width: 4000, snowLine: 0.45 },
        ];

        ranges.forEach((range, index) => {
            const geometry = new THREE.PlaneGeometry(range.width, range.height, this.qualityPreset.mountainSegments, this.qualityPreset.mountainSegments / 2);
            const posAttr = geometry.attributes.position;
            for (let i = 0; i < posAttr.count; i++) {
                const x = posAttr.getX(i);
                const noise = Math.sin(x * 0.003 + index) * 150 + Math.sin(x * 0.01 + index * 2) * 80;
                const y = posAttr.getY(i);
                const v = (y / range.height) + 0.5;
                if (v > 0.1) posAttr.setZ(i, noise * v);
            }
            geometry.computeVertexNormals();

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uBaseColor: { value: new THREE.Color(range.color) },
                    uSnowColor: { value: new THREE.Color(0xddeeff) }, // Warmer white for snow
                    uSnowLine: { value: range.snowLine },
                    uFogColor: { value: new THREE.Color(0x050a14) },
                    uFogDensity: { value: this.qualityPreset.fogDensity }
                },
                vertexShader: `
                    varying vec3 vPos; varying vec3 vNormal; 
                    void main() { 
                        vPos = (modelMatrix * vec4(position, 1.0)).xyz; 
                        vNormal = normalize(normalMatrix * normal); 
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); 
                    }
                `,
                fragmentShader: `
                    uniform vec3 uBaseColor; uniform vec3 uSnowColor; uniform float uSnowLine;
                    uniform vec3 uFogColor; uniform float uFogDensity;
                    varying vec3 vPos; varying vec3 vNormal;
                    void main() {
                        float slope = 1.0 - vNormal.y; // Steepness
                        float h = vPos.y;
                        
                        // Snow logic: higher up, and flatter surfaces
                        float snowThreshold = uSnowLine * 600.0 + sin(vPos.x * 0.01) * 50.0;
                        float snowFactor = smoothstep(snowThreshold, snowThreshold + 100.0, h);
                        snowFactor *= smoothstep(0.8, 0.3, slope); // Less snow on steep cliffs

                        vec3 color = mix(uBaseColor, uSnowColor, snowFactor);
                        
                        // Manual fog blend for mountains to get deep atmosphere
                        float depth = length(vPos - cameraPosition);
                        float fogFactor = 1.0 - exp(-depth * depth * uFogDensity * uFogDensity);
                        
                        gl_FragColor = vec4(mix(color, uFogColor, fogFactor), 1.0);
                    }
                `,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, -200, range.z);
            this.mountains.push(mesh);
            this.scene.add(mesh);
        });
    }

    createAuroraSystem() {
        this.auroraLayers = [];
        const layerCount = this.qualityPreset.auroraLayers || 1;
        const segments = this.qualityPreset.auroraSegments || 64;

        for (let i = 0; i < layerCount; i++) {
            // Each layer is a giant curved ribbon
            const geometry = new THREE.PlaneGeometry(3500, 1200, segments, segments);

            // Curve the plane manually
            const pos = geometry.attributes.position;
            for (let j = 0; j < pos.count; j++) {
                const x = pos.getX(j);
                const z = pos.getZ(j);
                // Bend Z based on X
                pos.setZ(j, z + Math.pow(x * 0.0005, 2.0) * 200.0);
            }
            geometry.computeVertexNormals();

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    ...VolumetricAuroraShader.uniforms,
                    uOffset: { value: i * 100.0 }, // Different noise seed offset
                    uOpacity: { value: 0.4 / layerCount }, // Distribute opacity
                    uSpeed: { value: 1.0 - i * 0.2 }, // Layers move at diff speeds for parallax
                },
                vertexShader: VolumetricAuroraShader.vertexShader,
                fragmentShader: VolumetricAuroraShader.fragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, 400 - i * 50, -1200 - i * 200);
            mesh.rotation.x = -0.3;

            this.auroraLayers.push(mesh);
            this.scene.add(mesh);
        }
    }

    createSnowParticles() {
        const count = this.qualityPreset.snowCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const depths = new Float32Array(count);
        const phases = new Float32Array(count);
        const wobbleSpeeds = new Float32Array(count);
        const rotationSpeeds = new Float32Array(count);
        const velocities = new Float32Array(count * 3);
        const bounds = { width: 900, height: 700, depth: 700 };

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * bounds.width;
            positions[i3 + 1] = (Math.random() - 0.5) * bounds.height + 100;
            positions[i3 + 2] = (Math.random() - 0.5) * bounds.depth - 200;
            depths[i] = Math.random();
            sizes[i] = 3.0 + Math.random() * 5.0;
            phases[i] = Math.random() * Math.PI * 2;
            wobbleSpeeds[i] = 1.0 + Math.random();
            rotationSpeeds[i] = (Math.random() - 0.5) * 2.0;
            velocities[i3 + 1] = -(15 + Math.random() * 25);
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('depth', new THREE.BufferAttribute(depths, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('wobbleSpeed', new THREE.BufferAttribute(wobbleSpeeds, 1));
        geometry.setAttribute('rotationSpeed', new THREE.BufferAttribute(rotationSpeeds, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                ...SnowShader.uniforms,
                uTexture: { value: this.snowflakeTexture },
                uUseTexture: { value: this.snowflakeTexture ? 1.0 : 0.0 },
            },
            vertexShader: SnowShader.vertexShader,
            fragmentShader: SnowShader.fragmentShader,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });

        this.snowParticles = new THREE.Points(geometry, material);
        this.snowVelocities = velocities;
        this.snowBounds = bounds;
        this.scene.add(this.snowParticles);
    }

    createIceBurstSystem() {
        const maxCount = this.qualityPreset.iceBurstCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxCount * 3);
        const sizes = new Float32Array(maxCount);
        const lives = new Float32Array(maxCount);
        const velocities = new Float32Array(maxCount * 3);
        for (let i = 0; i < maxCount; i++) positions[i * 3 + 1] = -9999;
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('life', new THREE.BufferAttribute(lives, 1));
        const material = new THREE.ShaderMaterial({
            uniforms: IceBurstShader.uniforms, vertexShader: IceBurstShader.vertexShader, fragmentShader: IceBurstShader.fragmentShader,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        this.iceBurstParticles = new THREE.Points(geometry, material);
        this.iceBurstData = { positions, velocities, lives, sizes, active: [], nextIndex: 0 };
        this.scene.add(this.iceBurstParticles);
    }

    spawnIceBurst(x, y, z, count) {
        // ... (Same logic as before, just kept concise)
        if (!this.iceBurstParticles) return;
        const d = this.iceBurstData;
        const max = this.qualityPreset.iceBurstCount;
        for (let i = 0; i < count; i++) {
            const idx = d.nextIndex; d.nextIndex = (d.nextIndex + 1) % max;
            const i3 = idx * 3;
            d.positions[i3] = x; d.positions[i3 + 1] = y; d.positions[i3 + 2] = z;
            const a = Math.random() * 6.28; const p = Math.random() * 3.14; const s = 15 + Math.random() * 35;
            d.velocities[i3] = Math.sin(p) * Math.cos(a) * s; d.velocities[i3 + 1] = Math.cos(p) * s; d.velocities[i3 + 2] = Math.sin(p) * Math.sin(a) * s;
            d.lives[idx] = 1.0; d.sizes[idx] = 4 + Math.random() * 6;
            if (!d.active.includes(idx)) d.active.push(idx);
        }
        this.iceBurstParticles.geometry.attributes.position.needsUpdate = true;
        this.iceBurstParticles.geometry.attributes.life.needsUpdate = true;
        this.iceBurstParticles.geometry.attributes.size.needsUpdate = true;
    }

    createWindStreaks() {
        const count = this.qualityPreset.streakCount;
        // Same simple streak system
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        const len = new Float32Array(count);
        const spd = new Float32Array(count);
        const off = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 1200;
            pos[i * 3 + 1] = (Math.random() - 0.5) * 700 + 100;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 500 - 100;
            len[i] = 15 + Math.random() * 25; spd[i] = 120 + Math.random() * 150;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('length', new THREE.BufferAttribute(len, 1));
        geo.setAttribute('speed', new THREE.BufferAttribute(spd, 1));
        geo.setAttribute('offset', new THREE.BufferAttribute(off, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: StreakShader.uniforms,
            vertexShader: StreakShader.vertexShader,
            fragmentShader: StreakShader.fragmentShader,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        this.windStreaks = new THREE.Points(geo, mat);
        this.scene.add(this.windStreaks);
    }

    createFrozenLightningEffect(cx, cy, cz) {
        // Recursive Fractal Lightning
        const pos = []; const alp = [];
        const gen = (sx, sy, sz, l, ax, ay, d) => {
            if (d <= 0) return;
            const ex = sx + Math.sin(ay) * Math.cos(ax) * l; const ey = sy + Math.cos(ay) * l; const ez = sz + Math.sin(ay) * Math.sin(ax) * l;
            pos.push(sx, sy, sz, ex, ey, ez); alp.push(1, 1);
            gen(ex, ey, ez, l * 0.7, ax + (Math.random() - 0.5) * 0.8, ay + (Math.random() - 0.5) * 0.8, d - 1);
            if (Math.random() > 0.5) gen(ex, ey, ez, l * 0.6, ax + (Math.random() - 0.5) * 1.5, ay + (Math.random() - 0.5) * 1.5, d - 1);
        };
        gen(cx, cy, cz, 50, Math.random() * 6.28, 2.5, 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('alpha', new THREE.Float32BufferAttribute(alp, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms: { ...FrozenLightningShader.uniforms }, vertexShader: FrozenLightningShader.vertexShader, fragmentShader: FrozenLightningShader.fragmentShader,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        const mesh = new THREE.LineSegments(geo, mat);
        mesh.userData = { life: 1.0 };
        this.frozenLightning.push(mesh);
        this.scene.add(mesh);
    }

    createVortexSystem(x, y, z) {
        // (Similar to previous step)
        const count = this.qualityPreset.vortexCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const angles = new Float32Array(count);
        const radii = new Float32Array(count);
        const speeds = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            angles[i] = Math.random() * Math.PI * 2;
            radii[i] = 40 + Math.random() * 150;
            speeds[i] = 1.5 + Math.random() * 3.0;
            sizes[i] = 2.0 + Math.random() * 3.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));
        geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1));
        geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                ...VortexShader.uniforms,
                uCenter: { value: new THREE.Vector3(x, y, z) },
                uIntensity: { value: 1.0 },
            },
            vertexShader: VortexShader.vertexShader,
            fragmentShader: VortexShader.fragmentShader,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });

        const vortex = new THREE.Points(geometry, material);
        vortex.userData = { life: 1.0 };
        this.vortexSystems.push(vortex);
        this.scene.add(vortex);
    }


    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) return;
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), this.qualityPreset.bloomStrength, this.qualityPreset.bloomRadius, 0.85);
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(new ShaderPass(VignetteShader));
    }

    setupEventListeners() {
        this.eventUnsubscribers.forEach(u => u()); this.eventUnsubscribers = [];
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.LINE_CLEAR, d => this.handleLineClear(d)),
            eventBus.on(EVENTS.COMBO, d => this.handleCombo(d)),
            eventBus.on(EVENTS.PIECE_LOCK, d => this.handlePieceLock())
        );
        this.resizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        window.addEventListener('resize', this.resizeHandler);
    }

    handleLineClear(data) {
        const d = data.detail || data;
        const lines = d.lineCount || 1;
        const combo = d.comboCount || this.pendingComboCount || 0;
        this.pendingComboCount = 0;

        this.onLineClear(lines, combo);
    }

    handleCombo(data) {
        const d = data.detail || data;
        const combo = d.comboCount || 0;
        if (combo > 0) this.pendingComboCount = combo;
        this.comboMultiplier = Math.min(1 + combo * 0.5, 4.0);
        this.comboDecay = 200;
    }

    handlePieceLock() {
        this.cameraShake.intensity += 0.5;
        this.cameraShake.intensity = Math.min(this.cameraShake.intensity, 2.5);
    }

    onLineClear(lines, combo) {
        const burst = Math.min(lines * 30 + combo * 20, 200);
        this.spawnIceBurst(0, -50, -200, burst);

        this.targetWindForce = (Math.random() > 0.5 ? 1 : -1) * (45 + combo * 15);
        this.gustIntensity = 1.0;
        this.gustDuration = 100 + combo * 50;

        if (lines >= 4 || combo >= 3) {
            this.createFrozenLightningEffect((Math.random() - 0.5) * 300, 100, -400);
        }

        if (combo >= 4) {
            this.createVortexSystem(0, 0, -200);
        }

        this.flashIntensity = 0.5 + Math.min(combo * 0.1, 1.0);
        this.cameraShake.intensity = Math.min(3 + lines + combo * 1.5, 12);

        // AURORA REACTS TO COMBO
        if (this.auroraLayers.length > 0) {
            this.auroraLayers.forEach(l => {
                if (l.material.uniforms.uIntensity) l.material.uniforms.uIntensity.value = 1.5 + Math.min(combo, 2.0);
            });
        }
    }

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;
            const delta = this.clock.getDelta();
            this.time += delta;

            // Updates
            this.updateEffectState(delta);
            this.updateSnowParticles(delta);
            this.updateIceBurst(delta);
            this.updateFrozenLightning(delta);
            this.updateVortexes(delta);

            // Updated Uniforms
            if (this.snowParticles) {
                const u = this.snowParticles.material.uniforms;
                u.uTime.value = this.time;
                u.uWindForce.value = this.windForce;
                u.uGustIntensity.value = this.gustIntensity;
                u.uFlashIntensity.value = this.flashIntensity;
            }
            if (this.windStreaks) {
                const u = this.windStreaks.material.uniforms;
                u.uTime.value = this.time;
                u.uWindForce.value = this.windForce;
                const spd = Math.abs(this.windForce);
                u.uOpacity.value = Math.min(Math.max((spd - 10.0) / 20.0, 0.0), 0.8) * this.gustIntensity;
            }
            this.auroraLayers.forEach(layer => {
                const u = layer.material.uniforms;
                u.uTime.value = this.time;
                // Decay intensity back to 1.0
                if (u.uIntensity.value > 1.0) u.uIntensity.value -= delta * 0.5;
            });
            if (this.starfield) this.starfield.material.uniforms.uTime.value = this.time;

            // Cam shake
            this.camera.position.x = this.cameraShake.x;
            this.camera.position.y = this.cameraShake.y;

            if (this.composer && this.qualityPreset.enablePostProcessing) {
                this.renderer.clear();
                this.composer.render();
            } else {
                this.renderer.clear();
                this.renderer.render(this.scene, this.camera);
            }
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    updateEffectState(delta) {
        if (this.comboDecay > 0) {
            this.comboDecay -= delta * 60;
            if (this.comboDecay <= 0) this.comboMultiplier = 1.0;
        }
        this.windForce += (this.targetWindForce - this.windForce) * 0.1;
        this.targetWindForce *= 0.95;
        if (this.gustDuration > 0) {
            this.gustDuration -= delta * 60;
            this.gustIntensity = Math.max(0, this.gustDuration / 120);
        } else {
            this.gustIntensity = 0;
        }
        this.flashIntensity *= 0.9;
        this.cameraShake.intensity *= 0.9;
        this.cameraShake.x = (Math.random() - 0.5) * this.cameraShake.intensity;
        this.cameraShake.y = (Math.random() - 0.5) * this.cameraShake.intensity;
    }

    updateSnowParticles(delta) {
        if (!this.snowParticles) return;
        const pos = this.snowParticles.geometry.attributes.position.array;
        const vel = this.snowVelocities;
        const b = this.snowBounds;
        for (let i = 0; i < pos.length / 3; i++) {
            const i3 = i * 3;
            pos[i3] += vel[i3] * delta;
            pos[i3 + 1] += vel[i3 + 1] * delta;
            pos[i3 + 2] += vel[i3 + 2] * delta;
            if (pos[i3 + 1] < -b.height / 2 || Math.abs(pos[i3]) > b.width || pos[i3 + 2] > 200) {
                pos[i3] = (Math.random() - 0.5) * b.width;
                pos[i3 + 1] = b.height / 2 + Math.random() * 50;
                pos[i3 + 2] = (Math.random() - 0.5) * b.depth - 200;
                vel[i3 + 1] = -(15 + Math.random() * 25);
            }
        }
        this.snowParticles.geometry.attributes.position.needsUpdate = true;
    }

    updateIceBurst(delta) {
        if (!this.iceBurstParticles) return;
        const d = this.iceBurstData;
        for (let j = d.active.length - 1; j >= 0; j--) {
            const idx = d.active[j];
            const i3 = idx * 3;
            d.velocities[i3 + 1] -= 50 * delta; // grav
            d.positions[i3] += d.velocities[i3] * delta;
            d.positions[i3 + 1] += d.velocities[i3 + 1] * delta;
            d.positions[i3 + 2] += d.velocities[i3 + 2] * delta;
            d.lives[idx] -= delta * 1.5;
            if (d.lives[idx] <= 0 || d.positions[i3 + 1] < -600) {
                d.lives[idx] = 0; d.positions[i3 + 1] = -9999; d.active.splice(j, 1);
            }
        }
        this.iceBurstParticles.geometry.attributes.position.needsUpdate = true;
        this.iceBurstParticles.geometry.attributes.life.needsUpdate = true;
    }

    updateFrozenLightning(delta) {
        for (let i = this.frozenLightning.length - 1; i >= 0; i--) {
            const l = this.frozenLightning[i];
            l.userData.life -= delta * 2.5;
            if (l.material.uniforms) {
                l.material.uniforms.uIntensity.value = l.userData.life;
                l.material.uniforms.uTime.value = this.time;
            }
            if (l.userData.life <= 0) {
                this.scene.remove(l); l.geometry.dispose(); l.material.dispose(); this.frozenLightning.splice(i, 1);
            }
        }
    }

    updateVortexes(delta) {
        for (let i = this.vortexSystems.length - 1; i >= 0; i--) {
            const v = this.vortexSystems[i];
            v.userData.life -= delta * 0.4;
            if (v.material.uniforms) {
                v.material.uniforms.uTime.value = this.time;
                v.material.uniforms.uIntensity.value = v.userData.life;
            }
            if (v.userData.life <= 0) {
                this.scene.remove(v); v.geometry.dispose(); v.material.dispose(); this.vortexSystems.splice(i, 1);
            }
        }
    }

    resize(w, h) {
        if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
        if (this.renderer) this.renderer.setSize(w, h);
        if (this.composer) this.composer.setSize(w, h);
    }

    stop() {
        if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
        this.eventUnsubscribers.forEach(u => u());
        super.stop();
    }

    cleanup() {
        this.stop();
        if (this.snowflakeTexture) this.snowflakeTexture.dispose();
        // ... (standard dispose)
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        super.cleanup();
    }
}
