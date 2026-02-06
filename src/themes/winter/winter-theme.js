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

import * as THREE from 'three/webgpu';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { WINTER_TETROMINOS } from './winter-tetrominos.js';
import { WinterPost } from './winter-post.js';
import { SnowParticleCompute } from './winter-compute.js';
import {
    createWinterSkyNodeMaterial,
    createWinterStarfieldNodeMaterial,
    createWinterMoonNodeMaterial,
    createWinterMoonHaloNodeMaterial,
    createWinterMountainNodeMaterial,
    createWinterAuroraNodeMaterial,
    createWinterSnowNodeMaterial,
    createWinterSnowflakeBillboardMaterial,
    createWinterWindStreakNodeMaterial,
    createWinterIceWispNodeMaterial,
    createWinterIceBurstNodeMaterial,
    createWinterFogNodeMaterial,
} from './winter-materials.js';

// Import enhanced shaders
import {
    iceWispVertexShader,
    iceWispFragmentShader,
    cometTrailVertexShader,
    cometTrailFragmentShader,
    cometHeadVertexShader,
    cometHeadFragmentShader,
    iceCrystalHeadVertexShader,
    iceCrystalHeadFragmentShader,
    iceCrystalTrailVertexShader,
    iceCrystalTrailFragmentShader,
    iceShardDebrisVertexShader,
    iceShardDebrisFragmentShader,
    frostRingShockwaveVertexShader,
    frostRingShockwaveFragmentShader,
    iceMistVertexShader,
    iceMistFragmentShader,
    blizzardWaveVertexShader,
    blizzardWaveFragmentShader,
    volumetricFogVertexShader,
    volumetricFogFragmentShader,
    moonRayVertexShader,
    moonRayFragmentShader,
    frostSnapVertexShader,
    frostSnapFragmentShader,
} from './winter-shaders.js';

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
        auroraLayers: 4,
        auroraSegments: 128,
        auroraDetail: 1.0,
        enableAurora: true,
        bloomStrength: 0.18,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        fogDensity: 0.0005,
        targetFps: 60,
        bloomScale: 0.6,
        // New enhanced effects
        iceWispCount: 40,
        iceWispTrailSegments: 5,
        closeSnowflakeCount: 180,
        maxShootingStars: 3,
        maxIceCrystalCrashes: 3,
        maxBlizzardWaves: 2,
        fogLayerCount: 3,
        enableCameraAnimation: true,
    },
    Ultra: {
        snowCount: 15000,
        iceBurstCount: 300,
        streakCount: 150,
        vortexCount: 200,
        mountainSegments: 96,
        auroraLayers: 3,
        auroraSegments: 96,
        auroraDetail: 0.9,
        enableAurora: true,
        bloomStrength: 0.16,
        bloomRadius: 0.5,
        enablePostProcessing: true,
        fogDensity: 0.0006,
        targetFps: 60,
        bloomScale: 0.6,
        // New enhanced effects
        iceWispCount: 30,
        iceWispTrailSegments: 4,
        closeSnowflakeCount: 140,
        maxShootingStars: 2,
        maxIceCrystalCrashes: 2,
        maxBlizzardWaves: 2,
        fogLayerCount: 2,
        enableCameraAnimation: true,
    },
    High: {
        snowCount: 10000,
        iceBurstCount: 200,
        streakCount: 100,
        vortexCount: 150,
        mountainSegments: 64,
        auroraLayers: 2,
        auroraSegments: 64,
        auroraDetail: 0.8,
        enableAurora: true,
        bloomStrength: 0.14,
        bloomRadius: 0.4,
        enablePostProcessing: true,
        fogDensity: 0.0008,
        targetFps: 60,
        bloomScale: 0.55,
        // New enhanced effects
        iceWispCount: 25,
        iceWispTrailSegments: 4,
        closeSnowflakeCount: 110,
        maxShootingStars: 2,
        maxIceCrystalCrashes: 2,
        maxBlizzardWaves: 1,
        fogLayerCount: 2,
        enableCameraAnimation: true,
    },
    Medium: {
        snowCount: 6000,
        iceBurstCount: 100,
        streakCount: 50,
        vortexCount: 100,
        mountainSegments: 48,
        auroraLayers: 1,
        auroraSegments: 48,
        auroraDetail: 0.6,
        enableAurora: true,
        bloomStrength: 0.12,
        bloomRadius: 0.3,
        enablePostProcessing: true,
        fogDensity: 0.001,
        targetFps: 60,
        bloomScale: 0.5,
        // New enhanced effects
        iceWispCount: 15,
        iceWispTrailSegments: 3,
        closeSnowflakeCount: 70,
        maxShootingStars: 1,
        maxIceCrystalCrashes: 1,
        maxBlizzardWaves: 1,
        fogLayerCount: 1,
        enableCameraAnimation: true,
    },
    Low: {
        snowCount: 3000,
        iceBurstCount: 50,
        streakCount: 20,
        vortexCount: 30,
        mountainSegments: 32,
        auroraLayers: 1,
        auroraSegments: 32,
        auroraDetail: 0.4,
        enableAurora: true,
        bloomStrength: 0.08,
        bloomRadius: 0.2,
        enablePostProcessing: false,
        fogDensity: 0.0015,
        targetFps: 60,
        bloomScale: 0.5,
        // New enhanced effects
        iceWispCount: 8,
        iceWispTrailSegments: 2,
        closeSnowflakeCount: 35,
        maxShootingStars: 1,
        maxIceCrystalCrashes: 1,
        maxBlizzardWaves: 0,
        fogLayerCount: 0,
        enableCameraAnimation: true,
    },
};

const WEBGPU_QUALITY_PRESETS = {
    'Extreme+': {
        snowCount: 30000,
        iceBurstCount: 600,
        auroraLayers: 5,
        auroraSegments: 192,
        auroraDetail: 1.0,
        bloomStrength: 0.24,
        bloomRadius: 0.6,
        bloomScale: 0.7,
        iceWispCount: 50,
        iceWispTrailSegments: 6,
        closeSnowflakeCount: 260,
        maxShootingStars: 4,
        maxIceCrystalCrashes: 4,
        maxBlizzardWaves: 3,
        fogLayerCount: 4,
        targetFps: 120,
        maxPixelRatio: 1.25,
        shaftSamples: 4,
    },
    Extreme: {
        snowCount: 22000,
        iceBurstCount: 500,
        auroraLayers: 4,
        auroraSegments: 128,
        auroraDetail: 1.0,
        bloomStrength: 0.22,
        bloomRadius: 0.55,
        bloomScale: 0.65,
        iceWispCount: 42,
        iceWispTrailSegments: 5,
        closeSnowflakeCount: 220,
        maxShootingStars: 3,
        maxIceCrystalCrashes: 3,
        maxBlizzardWaves: 2,
        fogLayerCount: 3,
        targetFps: 120,
        maxPixelRatio: 1.25,
        shaftSamples: 4,
    },
    Ultra: {
        snowCount: 18000,
        iceBurstCount: 420,
        auroraLayers: 3,
        auroraSegments: 96,
        auroraDetail: 0.9,
        bloomStrength: 0.2,
        bloomRadius: 0.5,
        bloomScale: 0.6,
        iceWispCount: 34,
        iceWispTrailSegments: 5,
        closeSnowflakeCount: 180,
        maxShootingStars: 3,
        maxIceCrystalCrashes: 3,
        maxBlizzardWaves: 2,
        fogLayerCount: 2,
        targetFps: 120,
        maxPixelRatio: 1.2,
        shaftSamples: 3,
    },
    High: {
        snowCount: 12000,
        iceBurstCount: 260,
        auroraLayers: 2,
        auroraSegments: 64,
        auroraDetail: 0.8,
        bloomStrength: 0.16,
        bloomRadius: 0.45,
        bloomScale: 0.6,
        iceWispCount: 26,
        iceWispTrailSegments: 4,
        closeSnowflakeCount: 140,
        maxShootingStars: 2,
        maxIceCrystalCrashes: 2,
        maxBlizzardWaves: 1,
        fogLayerCount: 2,
        targetFps: 120,
        maxPixelRatio: 1.2,
        shaftSamples: 3,
    },
    Medium: {
        snowCount: 8000,
        iceBurstCount: 140,
        auroraLayers: 1,
        auroraSegments: 48,
        auroraDetail: 0.6,
        bloomStrength: 0.13,
        bloomRadius: 0.35,
        bloomScale: 0.55,
        iceWispCount: 16,
        iceWispTrailSegments: 3,
        closeSnowflakeCount: 80,
        maxShootingStars: 1,
        maxIceCrystalCrashes: 1,
        maxBlizzardWaves: 1,
        fogLayerCount: 1,
        targetFps: 120,
        maxPixelRatio: 1.1,
        shaftSamples: 2,
    },
    Low: {
        snowCount: 4000,
        iceBurstCount: 70,
        auroraLayers: 1,
        auroraSegments: 32,
        auroraDetail: 0.4,
        bloomStrength: 0.1,
        bloomRadius: 0.25,
        bloomScale: 0.5,
        iceWispCount: 10,
        iceWispTrailSegments: 2,
        closeSnowflakeCount: 40,
        maxShootingStars: 1,
        maxIceCrystalCrashes: 1,
        maxBlizzardWaves: 0,
        fogLayerCount: 0,
        targetFps: 120,
        maxPixelRatio: 1.0,
        shaftSamples: 2,
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
        uColor: { value: new THREE.Color(0xbfd6ff) }, // Cold white/blue
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
    uniforms: { tDiffuse: { value: null }, darkness: { value: 0.75 }, offset: { value: 1.1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
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
        uTime: { value: 0 },
        uWindForce: { value: 0 },
        uGustIntensity: { value: 0 },
        uComboMultiplier: { value: 1.0 },
        uFlashIntensity: { value: 0 },
        uTexture: { value: null },
        uUseTexture: { value: 0.0 },
    },
    vertexShader: `
        attribute float size; attribute float depth; attribute float phase; attribute float wobbleSpeed; attribute float rotationSpeed;
        uniform float uTime; uniform float uWindForce; uniform float uGustIntensity;
        varying float vDepth; varying float vPhase; varying float vRotation; varying float vDof;
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
            float nearFocus = smoothstep(0.05, 0.25, depth);
            float farFocus = 1.0 - smoothstep(0.75, 0.95, depth);
            vDof = nearFocus * farFocus;
            float blurScale = mix(1.5, 1.0, vDof);
            gl_PointSize = size * depthScale * blurScale * (600.0 / -mvPosition.z);
            vRotation = uTime * rotationSpeed + phase;
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        uniform float uTime; uniform float uFlashIntensity; uniform sampler2D uTexture; uniform float uUseTexture;
        varying float vDepth; varying float vPhase; varying float vRotation; varying float vDof;
        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            float s = sin(vRotation); float c = cos(vRotation);
            vec2 rotatedCoord = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c) + 0.5;
            vec4 texColor = vec4(1.0);
            if (uUseTexture > 0.5) texColor = texture2D(uTexture, rotatedCoord);
            else { float dist = length(coord); float alpha = 1.0 - smoothstep(0.3, 0.5, dist); texColor = vec4(1.0, 1.0, 1.0, alpha); }
            float depthAlpha = (0.2 + vDepth * 0.6) * 0.8; 
            float twinkle = 0.85 + 0.15 * sin(uTime * 3.0 + vPhase * 10.0);
            float flash = 0.9 + clamp(uFlashIntensity, 0.0, 1.0) * 0.8;
            float dofAlpha = mix(0.5, 1.0, vDof);
            gl_FragColor = vec4(texColor.rgb * flash * 0.9, texColor.a * depthAlpha * twinkle * dofAlpha);
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
        this.renderer = null; this.scene = null; this.camera = null; this.composer = null; this.post = null;

        this.snowParticles = null;
        this.closeSnowflakes = null;
        this.closeSnowflakeData = null;
        this.closeSnowflakeUniforms = null;
        this.auroraLayers = [];
        this.mountains = [];
        this.moon = null;
        this.moonHalo = null;
        this.iceBurstParticles = null;
        this.frozenLightning = [];
        this.windStreaks = null;
        this.vortexSystems = [];
        this.starUniforms = null;
        this.snowUniforms = null;
        this.snowCompute = null;
        this.auroraUniforms = [];
        this.moonUniforms = null;
        this.moonHaloUniforms = null;
        this.windStreakUniforms = null;
        this.iceWispUniforms = null;
        this.mrtAuditEnabled = false;
        this.starMaxCount = 0;

        this.snowflakeTexture = null;

        // === NEW ENHANCED EFFECTS ===
        this.iceWisps = null;
        this.shootingStars = [];
        this.lastShootingStarTime = 0;
        this.nextShootingStarDelay = 15 + Math.random() * 20;
        this.iceCrystalCrashes = [];
        this.blizzardWaves = [];
        this.fogLayers = [];
        this.moonRays = [];

        // Effect state for smooth transitions
        this.effectState = {
            iceWispSurge: 0,
            bloomBoost: 0,
            auroraBoost: 0,
        };

        this.windForce = 0; this.targetWindForce = 0;
        this.gustIntensity = 0; this.gustDuration = 0;
        this.comboMultiplier = 1.0; this.comboDecay = 0;
        this.flashIntensity = 0;
        this.cameraShake = { x: 0, y: 0, intensity: 0 };
        // Base camera position for animation
        this.baseCameraPosition = { x: 0, y: 0, z: 100 };

        this.comboWindTimer = 0; this.pendingComboCount = 0;
        this.clock = new THREE.Clock(); this.time = 0;

        this._moonScreen = new THREE.Vector3();
        this._moonUv = new THREE.Vector2();

        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.iceBurstData = {
            positions: null, velocities: null, lives: null, sizes: null, active: [], nextIndex: 0,
        };

        this.snowMaxCount = 0;
        this.snowDrawCount = 0;
        this.closeSnowflakeMaxCount = 0;
        this.windStreakMaxCount = 0;
        this.iceWispMaxCount = 0;
        this.iceWispTrailSegments = 0;
        this.auroraLayerMax = 0;
        this.fogLayerMax = 0;
        this.snowLod = 1.0;
        this.postPerfScale = 1.0;
        this.basePixelRatio = 1.0;
        this.pixelRatioScale = 1.0;
        this.frameTimeMs = 16.7;
        this.lodAdjustTimer = 0;
        this.targetFrameTime = 1000 / 60;
        this.snowUpdateStride = 1;
        this.snowUpdateFrame = 0;
        this.snowUpdateAccumulator = 0;
        this.closeSnowflakeFrameStride = 1;
        this.closeSnowflakeFrame = 0;
        this.closeSnowflakeAccumulator = 0;
        this.forceWebGL = false;
        this.baselineEnabled = false;
        this.baselineFrames = [];
        this.baselineMaxFrames = 600;

        console.log('[WinterTheme] Theme constructed');
    }

    getTetrominoConfig() { return WINTER_TETROMINOS; }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            const raw = String(window.settings.effectQuality).trim();
            if (/^extreme\s*\+$/i.test(raw) || /extreme\s*plus/i.test(raw)) {
                return 'Extreme+';
            }
            return normalizeQuality(raw);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.currentQuality = quality || 'High';
        let selected = this.currentQuality;
        if (selected === 'Extreme+' && !this.isWebGPU) {
            selected = 'Extreme';
        }
        const basePreset = QUALITY_PRESETS[selected] || QUALITY_PRESETS.High;
        const webgpuPreset = this.isWebGPU ? WEBGPU_QUALITY_PRESETS[selected] : null;
        this.qualityPreset = webgpuPreset ? { ...basePreset, ...webgpuPreset } : basePreset;
        const targetFps = this.qualityPreset.targetFps || 60;
        this.targetFrameTime = 1000 / targetFps;

        if (this.renderer) {
            const maxRatio = this.qualityPreset.maxPixelRatio ?? 2;
            this.basePixelRatio = this.getEffectivePixelRatio(maxRatio);
            this.pixelRatioScale = 1.0;
            this.renderer.setPixelRatio(this.basePixelRatio);
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
            if (this.post && typeof this.post.setSize === 'function') {
                this.post.setSize(window.innerWidth, window.innerHeight);
            }
        }
    }

    isNodeMaterial(material) {
        if (!material) return false;
        if (material.isNodeMaterial) return true;
        if (
            material.isMeshBasicNodeMaterial
            || material.isMeshStandardNodeMaterial
            || material.isMeshPhysicalNodeMaterial
            || material.isMeshPhongNodeMaterial
            || material.isPointsNodeMaterial
        ) {
            return true;
        }
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    auditMrtMaterials(label = 'MRT Audit') {
        if (!this.isWebGPU || !this.scene) return;

        const seen = new Set();
        const nonNode = [];
        const missingEmissive = [];

        const recordMaterial = (material, object) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach((mat) => recordMaterial(mat, object));
                return;
            }
            if (seen.has(material)) return;
            seen.add(material);

            const objectName = object?.name || object?.type || 'UnknownObject';
            const materialName = material.name || material.type || material.constructor?.name || 'UnknownMaterial';

            if (!this.isNodeMaterial(material)) {
                nonNode.push({ objectName, materialName });
                return;
            }
            if (!('emissiveNode' in material) || !material.emissiveNode) {
                missingEmissive.push({ objectName, materialName });
            }
        };

        if (this.scene.material) {
            recordMaterial(this.scene.material, this.scene);
        }
        this.scene.traverse((child) => {
            if (child.material) {
                recordMaterial(child.material, child);
            }
        });

        const formatSample = (entries) => entries
            .slice(0, 12)
            .map((entry) => `- ${entry.objectName}: ${entry.materialName}`)
            .join('\n');

        console.groupCollapsed(`[WinterTheme][${label}] WebGPU MRT material audit`);
        console.log(`Total unique materials: ${seen.size}`);
        console.log(`Non-NodeMaterials: ${nonNode.length}`);
        if (nonNode.length) console.warn(formatSample(nonNode));
        console.log(`NodeMaterials missing emissiveNode: ${missingEmissive.length}`);
        if (missingEmissive.length) console.warn(formatSample(missingEmissive));
        console.groupEnd();
    }

    async createScene() {
        if (typeof document === 'undefined') return;
        this.currentQuality = this.getCurrentQualityLevel();
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            this.mrtAuditEnabled = params.get('winterMrtAudit') === '1';
            this.forceWebGL = params.get('forceWebGL') === '1';
            this.baselineEnabled = params.get('winterBaseline') === '1';
        }
        this.snowflakeTexture = createSnowflakeTexture();

        const container = document.getElementById('winter-theme');
        if (!container) return;
        const oldCanvas = container.querySelector('#winter-canvas');
        if (oldCanvas) oldCanvas.style.display = 'none';

        await this.initRenderer(container);
        if (!this.renderer) return;
        this.applyQualityPreset(this.currentQuality);
        if (this.baselineEnabled && typeof window !== 'undefined') {
            window.winterBaseline = {
                capture: (label) => this.captureBaseline(label),
                report: () => this.reportBaseline(),
                reset: () => this.resetBaseline(),
            };
            console.log('[WinterBaseline] Helpers: window.winterBaseline.capture(label), report(), reset()');
        }
        this.createSkyBackground();
        this.createMoon();
        this.createMountains();
        if (this.qualityPreset.enableAurora) this.createAuroraSystem();
        this.createSnowParticles();
        this.createCloseSnowflakes();
        this.createIceBurstSystem();
        this.createWindStreaks();

        // === NEW ENHANCED EFFECTS ===
        this.createIceWisps();
        this.createFogLayers();

        if (this.mrtAuditEnabled) {
            this.auditMrtMaterials('PrePost');
        }
        this.setupPostProcessing();
        this.setupEventListeners();
        this.startAnimation();
    }

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.renderer = new THREE.WebGPURenderer({
            antialias: this.getAntialiasEnabled(),
            alpha: false,
            forceWebGL: this.forceWebGL === true,
            preserveDrawingBuffer: this.baselineEnabled === true,
        });
        try {
            await this.renderer.init();
        } catch (error) {
            console.error('[WinterTheme] Renderer init failed:', error);
            this.renderer = null;
            return;
        }

        this.isWebGPU = this.renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = this.renderer.backend?.isWebGLBackend === true;
        this.renderer.setClearColor(0x020408, 1); // Darker base
        this.basePixelRatio = this.getEffectivePixelRatio();
        this.pixelRatioScale = 1.0;
        this.renderer.setPixelRatio(this.basePixelRatio);
        this.renderer.setSize(width, height);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.sortObjects = false;
        this.renderer.autoClear = true;
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        // Rich Midnight Fog
        const fogColor = new THREE.Color(0x03060e);
        this.scene.fog = new THREE.FogExp2(fogColor, this.qualityPreset.fogDensity * 1.1);
        this.scene.background = fogColor;

        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 8000);
        this.camera.position.set(0, 0, 100);
        this.camera.lookAt(0, 0, -500);

        this.scene.add(new THREE.AmbientLight(0x243248, 0.2));
        const moonLight = new THREE.DirectionalLight(0x9bb8e6, 0.6);
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
        const colors = new Float32Array(starCount * 3);
        const twinkles = new Float32Array(starCount);
        const color = new THREE.Color();

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
            twinkles[i] = Math.random();

            const hue = 0.55 + Math.random() * 0.15;
            const sat = 0.15 + Math.random() * 0.15;
            const light = 0.55 + Math.random() * 0.25;
            color.setHSL(hue, sat, light);
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('twinkle', new THREE.BufferAttribute(twinkles, 1));

        let material = null;
        if (this.isWebGPU) {
            const { material: starMaterial, uniforms } = createWinterStarfieldNodeMaterial();
            material = starMaterial;
            this.starUniforms = uniforms;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: { uTime: { value: 0 } },
                vertexShader: `
                    attribute float size; attribute float phase; attribute float twinkle; attribute vec3 color;
                    varying float vPhase; varying float vTwinkle; varying vec3 vColor;
                    void main() {
                        vPhase = phase;
                        vTwinkle = twinkle;
                        vColor = color;
                        gl_PointSize = size;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float uTime; varying float vPhase; varying float vTwinkle; varying vec3 vColor;
                    void main() {
                        vec2 coord = gl_PointCoord - 0.5; if (length(coord) > 0.5) discard;
                        float speed = mix(0.8, 2.2, vTwinkle);
                        float twinkle = 0.5 + 0.5 * sin(uTime * speed + vPhase * 10.0);
                        float alpha = (1.0 - length(coord) * 2.0) * (0.1 + twinkle * 0.4);
                        gl_FragColor = vec4(vColor, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.starUniforms = null;
        }

        this.starfield = new THREE.Points(geometry, material);
        this.scene.add(this.starfield);
        this.starMaxCount = starCount;
        this.starfield.geometry.setDrawRange(0, starCount);

        // Backdrop gradient mesh
        const skyGeo = new THREE.SphereGeometry(4500, 32, 32);
        let skyMat = null;
        if (this.isWebGPU) {
                const { material: skyMaterial } = createWinterSkyNodeMaterial({
                    top: new THREE.Color(0x00030a),
                    mid: new THREE.Color(0x020613),
                    bottom: new THREE.Color(0x091222),
                });
                skyMat = skyMaterial;
            } else {
                skyMat = new THREE.ShaderMaterial({
                    uniforms: {
                        uTop: { value: new THREE.Color(0x00030a) },
                        uMid: { value: new THREE.Color(0x020613) },
                        uBot: { value: new THREE.Color(0x091222) },
                    },
                vertexShader: 'varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
                fragmentShader: `
                    uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; varying vec3 vPos;
                    void main() {
                        float h = normalize(vPos).y;
                        vec3 col = mix(uMid, uTop, smoothstep(0.0, 1.0, h));
                        col = mix(uBot, col, smoothstep(-0.2, 0.2, h));
                        gl_FragColor = vec4(col, 1.0);
                    }
                `,
                side: THREE.BackSide,
            });
        }
        this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    }

    createMoon() {
        const geometry = new THREE.SphereGeometry(150, 64, 64);
        let material = null;
        if (this.isWebGPU) {
            const { material: moonMaterial, uniforms } = createWinterMoonNodeMaterial();
            material = moonMaterial;
            this.moonUniforms = uniforms;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: MoonShader.uniforms,
                vertexShader: MoonShader.vertexShader,
                fragmentShader: MoonShader.fragmentShader,
            });
            this.moonUniforms = null;
        }
        this.moon = new THREE.Mesh(geometry, material);
        this.moon.position.set(500, 1000, -800);
        this.scene.add(this.moon);

        if (this.isWebGPU) {
            const haloGeo = new THREE.SphereGeometry(190, 48, 48);
            const { material: haloMaterial, uniforms } = createWinterMoonHaloNodeMaterial();
            this.moonHalo = new THREE.Mesh(haloGeo, haloMaterial);
            this.moonHaloUniforms = uniforms;
            this.moon.add(this.moonHalo);
            return;
        }

        // Moon Glow sprite
        const spriteMat = new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(this.createGlowCanvas()),
            color: 0xaaddff,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Sprite(spriteMat);
        glow.scale.set(600, 600, 1);
        this.moon.userData = { glow, glowBase: 600 };
        this.moon.add(glow);

        // === NEW: Moon God-Rays ===
        const rayGeo = new THREE.PlaneGeometry(800, 1500);
        const rayMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uOpacity: { value: 0.2 },
                uIntensity: { value: 1.0 },
            },
            vertexShader: moonRayVertexShader,
            fragmentShader: moonRayFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        // Multiple rays
        for (let i = 0; i < 3; i++) {
            const ray = new THREE.Mesh(rayGeo, rayMat.clone());
            ray.position.y = -600;
            ray.position.z = 50 + i * 20;
            ray.rotation.z = 0.1 - i * 0.1;
            this.moonRays.push(ray);
            this.moon.add(ray);
        }
    }

    updateMoonEffects(delta) {
        if (!this.moon) return;

        if (this.moonUniforms?.uTime) {
            this.moonUniforms.uTime.value = this.time;
        }
        if (this.moonHaloUniforms?.uTime) {
            this.moonHaloUniforms.uTime.value = this.time;
            if (this.moonHaloUniforms.uIntensity) {
                this.moonHaloUniforms.uIntensity.value = 0.35 + this.flashIntensity * 0.15;
            }
        }

        // Pulse glow
        if (this.moon.userData.glow) {
            const pulse = 1.0 + Math.sin(this.time * 2.0) * 0.05 + this.flashIntensity * 0.2;
            const size = this.moon.userData.glowBase * pulse;
            this.moon.userData.glow.scale.set(size, size, 1);
        }

        // Update rays
        this.moonRays.forEach((ray, i) => {
            ray.material.uniforms.uTime.value = this.time + i * 10.0;
            // Boost intensity with combos
            ray.material.uniforms.uIntensity.value = 1.0 + this.flashIntensity * 3.0;
        });
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
            {
                z: -1800, color: 0x060c15, height: 700, width: 5000, snowLine: 0.35,
            },
            {
                z: -1100, color: 0x091220, height: 450, width: 4000, snowLine: 0.45,
            },
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

            let material = null;
            if (this.isWebGPU) {
                const { material: mountainMaterial } = createWinterMountainNodeMaterial({
                    baseColor: new THREE.Color(range.color),
                    snowColor: new THREE.Color(0xddeeff),
                    snowLine: range.snowLine,
                    fogColor: new THREE.Color(0x03060e),
                    fogDensity: this.qualityPreset.fogDensity,
                });
                material = mountainMaterial;
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uBaseColor: { value: new THREE.Color(range.color) },
                        uSnowColor: { value: new THREE.Color(0xddeeff) }, // Warmer white for snow
                        uSnowLine: { value: range.snowLine },
                        uFogColor: { value: new THREE.Color(0x03060e) },
                        uFogDensity: { value: this.qualityPreset.fogDensity * 1.1 },
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
            }
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
                pos.setZ(j, z + (x * 0.0005) ** 2.0 * 200.0);
            }
            geometry.computeVertexNormals();

            let material = null;
            if (this.isWebGPU) {
                const { material: auroraMaterial, uniforms } = createWinterAuroraNodeMaterial({
                    offset: i * 100.0,
                    opacity: 0.3 / layerCount,
                    speed: 1.0 - i * 0.2,
                    detail: this.qualityPreset.auroraDetail ?? 1.0,
                });
                material = auroraMaterial;
                material.userData.uniforms = uniforms;
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        ...VolumetricAuroraShader.uniforms,
                        uOffset: { value: i * 100.0 }, // Different noise seed offset
                        uOpacity: { value: 0.3 / layerCount }, // Distribute opacity
                        uSpeed: { value: 1.0 - i * 0.2 }, // Layers move at diff speeds for parallax
                    },
                    vertexShader: VolumetricAuroraShader.vertexShader,
                    fragmentShader: VolumetricAuroraShader.fragmentShader,
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                });
            }

            const mesh = new THREE.Mesh(geometry, material);
            if (this.isWebGPU && material.userData?.uniforms) {
                mesh.userData.uniforms = material.userData.uniforms;
            }
            mesh.position.set(0, 400 - i * 50, -1200 - i * 200);
            mesh.rotation.x = -0.3;

            this.auroraLayers.push(mesh);
            this.scene.add(mesh);
        }
        this.auroraLayerMax = this.auroraLayers.length;
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

        if (this.snowCompute) {
            this.snowCompute.dispose();
            this.snowCompute = null;
        }
        if (this.isWebGPU) {
            this.snowCompute = new SnowParticleCompute(count, bounds);
            this.snowCompute.setInitialState(positions, velocities);
            this.snowCompute.createComputeNode();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('depth', new THREE.BufferAttribute(depths, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('wobbleSpeed', new THREE.BufferAttribute(wobbleSpeeds, 1));
        geometry.setAttribute('rotationSpeed', new THREE.BufferAttribute(rotationSpeeds, 1));

        let material = null;
        if (this.isWebGPU) {
            const { material: snowMaterial, uniforms } = createWinterSnowNodeMaterial({
                isWebGPU: this.isWebGPU,
                snowCompute: this.snowCompute,
            });
            material = snowMaterial;
            this.snowUniforms = uniforms;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    ...SnowShader.uniforms,
                    uTexture: { value: this.snowflakeTexture },
                    uUseTexture: { value: this.snowflakeTexture ? 1.0 : 0.0 },
                },
                vertexShader: SnowShader.vertexShader,
                fragmentShader: SnowShader.fragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.snowUniforms = null;
        }

        this.snowParticles = new THREE.Points(geometry, material);
        this.snowVelocities = velocities;
        this.snowBounds = bounds;
        this.snowMaxCount = count;
        this.snowDrawCount = count;
        this.snowParticles.geometry.setDrawRange(0, count);
        this.scene.add(this.snowParticles);
    }

    createCloseSnowflakes() {
        const count = this.qualityPreset.closeSnowflakeCount || 0;
        if (count === 0 || !this.snowflakeTexture) return;

        const geometry = new THREE.PlaneGeometry(1, 1);
        const { material, uniforms } = createWinterSnowflakeBillboardMaterial({
            map: this.snowflakeTexture,
            opacity: 0.7,
        });
        this.closeSnowflakeUniforms = uniforms;

        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.renderOrder = 120;

        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const depths = new Float32Array(count);
        const phases = new Float32Array(count);
        const wobbleSpeeds = new Float32Array(count);
        const rotations = new Float32Array(count);
        const rotationSpeeds = new Float32Array(count);
        const bounds = { width: 600, height: 500, depth: 700 };
        const dummy = new THREE.Object3D();

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * bounds.width;
            positions[i3 + 1] = -150 + Math.random() * bounds.height;
            positions[i3 + 2] = -50 - Math.random() * bounds.depth;

            velocities[i3] = 0;
            velocities[i3 + 1] = -(15 + Math.random() * 25);
            velocities[i3 + 2] = 0;

            sizes[i] = 2 + Math.random() * 5;
            depths[i] = Math.random();
            phases[i] = Math.random() * Math.PI * 2;
            wobbleSpeeds[i] = 1.0 + Math.random();
            rotations[i] = Math.random() * Math.PI * 2;
            rotationSpeeds[i] = (Math.random() - 0.5) * 1.2;

            dummy.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
            dummy.quaternion.copy(this.camera.quaternion);
            dummy.rotateZ(rotations[i]);
            dummy.scale.set(sizes[i], sizes[i], 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;

        this.closeSnowflakes = mesh;
        this.closeSnowflakeData = {
            positions,
            velocities,
            sizes,
            depths,
            phases,
            wobbleSpeeds,
            rotations,
            rotationSpeeds,
            bounds,
            dummy,
        };
        this.closeSnowflakeMaxCount = count;
        this.closeSnowflakes.count = count;

        this.scene.add(mesh);
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
        let material = null;
        if (this.isWebGPU) {
            const { material: iceBurstMaterial } = createWinterIceBurstNodeMaterial();
            material = iceBurstMaterial;
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: IceBurstShader.uniforms,
                vertexShader: IceBurstShader.vertexShader,
                fragmentShader: IceBurstShader.fragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
        }
        this.iceBurstParticles = new THREE.Points(geometry, material);
        this.iceBurstData = {
            positions, velocities, lives, sizes, active: [], nextIndex: 0,
        };
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

        let mat = null;
        if (this.isWebGPU) {
            const { material, uniforms } = createWinterWindStreakNodeMaterial();
            mat = material;
            this.windStreakUniforms = uniforms;
        } else {
            mat = new THREE.ShaderMaterial({
                uniforms: StreakShader.uniforms,
                vertexShader: StreakShader.vertexShader,
                fragmentShader: StreakShader.fragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            this.windStreakUniforms = null;
        }
        this.windStreaks = new THREE.Points(geo, mat);
        this.scene.add(this.windStreaks);
        this.windStreakMaxCount = count;
        this.windStreaks.geometry.setDrawRange(0, count);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW ENHANCED EFFECTS - Phase 1: Ice Wisps (Floating Spirit Particles)
    // ─────────────────────────────────────────────────────────────────────────

    createIceWisps() {
        const count = this.qualityPreset.iceWispCount || 0;
        if (count === 0) return;
        const trailSegments = this.qualityPreset.iceWispTrailSegments || 4;
        const total = count * trailSegments;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(total * 3);
        const phases = new Float32Array(total);
        const speeds = new Float32Array(total);
        const sizes = new Float32Array(total);
        const brightness = new Float32Array(total);
        const trails = new Float32Array(total);

        for (let i = 0; i < count; i++) {
            // Scatter around aurora and mountains area
            const baseX = (Math.random() - 0.5) * 1000;
            const baseY = -50 + Math.random() * 350;
            const baseZ = -300 - Math.random() * 600;
            const basePhase = Math.random() * Math.PI * 2;
            const baseSpeed = 0.3 + Math.random() * 0.7;
            const baseSize = 25 + Math.random() * 40;
            const baseBrightness = 0.6 + Math.random() * 0.4;

            for (let j = 0; j < trailSegments; j++) {
                const idx = i * trailSegments + j;
                const i3 = idx * 3;
                positions[i3] = baseX;
                positions[i3 + 1] = baseY;
                positions[i3 + 2] = baseZ;
                phases[idx] = basePhase;
                speeds[idx] = baseSpeed;
                sizes[idx] = baseSize;
                brightness[idx] = baseBrightness;
                trails[idx] = trailSegments === 1 ? 0 : j / (trailSegments - 1);
            }
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
        geometry.setAttribute('aTrail', new THREE.BufferAttribute(trails, 1));

        let material = null;
        if (this.isWebGPU) {
            const { material: wispMaterial, uniforms } = createWinterIceWispNodeMaterial();
            material = wispMaterial;
            this.iceWispUniforms = uniforms;
            if (this.renderer && this.iceWispUniforms?.uPixelRatio) {
                this.iceWispUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
            }
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uPixelRatio: { value: this.renderer.getPixelRatio() },
                    uSurgeIntensity: { value: 0 },
                },
                vertexShader: iceWispVertexShader,
                fragmentShader: iceWispFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            this.iceWispUniforms = null;
        }

        this.iceWisps = new THREE.Points(geometry, material);
        this.iceWisps.renderOrder = 100;
        this.scene.add(this.iceWisps);
        this.iceWispMaxCount = count;
        this.iceWispTrailSegments = trailSegments;
        this.iceWisps.geometry.setDrawRange(0, total);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW ENHANCED EFFECTS - Volumetric Fog Layers
    // ─────────────────────────────────────────────────────────────────────────

    createFogLayers() {
        const layerCount = this.qualityPreset.fogLayerCount || 0;
        if (layerCount === 0) return;

        const configs = [
            {
                y: -150, z: -400, width: 2500, height: 350, speed: 0.008, opacity: 0.1,
            },
            {
                y: -100, z: -700, width: 3000, height: 400, speed: 0.005, opacity: 0.07,
            },
            {
                y: -50, z: -1000, width: 3500, height: 450, speed: 0.003, opacity: 0.05,
            },
        ];

        for (let i = 0; i < Math.min(layerCount, configs.length); i++) {
            const config = configs[i];
            const geometry = new THREE.PlaneGeometry(config.width, config.height);

            let material = null;
            if (this.isWebGPU) {
                const { material: fogMaterial, uniforms } = createWinterFogNodeMaterial({
                    opacity: config.opacity,
                    speed: config.speed,
                });
                material = fogMaterial;
                material.userData = material.userData || {};
                material.userData.uniforms = uniforms;
            } else {
                material = new THREE.ShaderMaterial({
                    uniforms: {
                        uTime: { value: 0 },
                        uOpacity: { value: config.opacity },
                        uSpeed: { value: config.speed },
                    },
                    vertexShader: volumetricFogVertexShader,
                    fragmentShader: volumetricFogFragmentShader,
                    transparent: true,
                    blending: THREE.NormalBlending,
                    depthWrite: false,
                    side: THREE.DoubleSide,
                });
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(0, config.y, config.z);
            mesh.renderOrder = -100 - i;
            if (this.isWebGPU && material.userData?.uniforms) {
                mesh.userData.uniforms = material.userData.uniforms;
            }

            this.fogLayers.push(mesh);
            this.scene.add(mesh);
        }
        this.fogLayerMax = this.fogLayers.length;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW ENHANCED EFFECTS - Shooting Stars / Comets
    // ─────────────────────────────────────────────────────────────────────────

    createShootingStar() {
        if (this.isWebGPU) return;
        const maxStars = this.qualityPreset.maxShootingStars || 0;
        if (this.shootingStars.length >= maxStars) return;

        // Start position in upper sky
        const startX = (Math.random() - 0.5) * 1000;
        const startY = 300 + Math.random() * 200;
        const startZ = -800 - Math.random() * 500;

        // Diagonal downward trajectory
        const angle = -0.3 - Math.random() * 0.4;
        const direction = Math.random() > 0.5 ? 1 : -1;
        const speed = 300 + Math.random() * 200;
        const trailLength = 120 + Math.random() * 80;
        const duration = 2.0 + Math.random() * 1.5;

        // Trail geometry
        const trailSegments = 35;
        const positions = new Float32Array(trailSegments * 3);
        const trailPositions = new Float32Array(trailSegments);

        for (let i = 0; i < trailSegments; i++) {
            positions[i * 3] = startX;
            positions[i * 3 + 1] = startY;
            positions[i * 3 + 2] = startZ;
            trailPositions[i] = i / (trailSegments - 1);
        }

        const trailGeometry = new THREE.BufferGeometry();
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        trailGeometry.setAttribute('aTrailPosition', new THREE.BufferAttribute(trailPositions, 1));

        const trailMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
            },
            vertexShader: cometTrailVertexShader,
            fragmentShader: cometTrailFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const trail = new THREE.Line(trailGeometry, trailMaterial);
        trail.renderOrder = 200;

        // Glowing head
        const headGeometry = new THREE.BufferGeometry();
        headGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([startX, startY, startZ]), 3));

        const headMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProgress: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
            },
            vertexShader: cometHeadVertexShader,
            fragmentShader: cometHeadFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const head = new THREE.Points(headGeometry, headMaterial);
        head.renderOrder = 201;

        const meteor = new THREE.Group();
        meteor.add(trail);
        meteor.add(head);

        meteor.userData = {
            startTime: this.time,
            duration,
            startX,
            startY,
            startZ,
            angle,
            direction,
            speed,
            trailLength,
            trailSegments,
            trail,
            head,
        };

        this.shootingStars.push(meteor);
        this.scene.add(meteor);
    }

    updateShootingStars() {
        // Auto-spawn periodically
        if (this.time - this.lastShootingStarTime > this.nextShootingStarDelay) {
            this.createShootingStar();
            this.lastShootingStarTime = this.time;
            this.nextShootingStarDelay = 20 + Math.random() * 25;
        }

        // Update existing shooting stars
        for (let i = this.shootingStars.length - 1; i >= 0; i--) {
            const star = this.shootingStars[i];
            const data = star.userData;
            const elapsed = this.time - data.startTime;
            const progress = elapsed / data.duration;

            if (progress > 1.0) {
                this.scene.remove(star);
                data.trail.geometry.dispose();
                data.trail.material.dispose();
                data.head.geometry.dispose();
                data.head.material.dispose();
                this.shootingStars.splice(i, 1);
                continue;
            }

            const travelDistance = elapsed * data.speed;
            const headX = data.startX + Math.cos(data.angle) * travelDistance * data.direction;
            const headY = data.startY + Math.sin(data.angle) * travelDistance;
            const headZ = data.startZ;

            // Update trail
            const trailPositions = data.trail.geometry.attributes.position.array;
            for (let j = 0; j < data.trailSegments; j++) {
                const t = j / (data.trailSegments - 1);
                const trailOffset = t * data.trailLength;
                trailPositions[j * 3] = headX - Math.cos(data.angle) * trailOffset * data.direction;
                trailPositions[j * 3 + 1] = headY - Math.sin(data.angle) * trailOffset;
                trailPositions[j * 3 + 2] = headZ;
            }
            data.trail.geometry.attributes.position.needsUpdate = true;

            data.trail.material.uniforms.uTime.value = this.time;
            data.trail.material.uniforms.uProgress.value = progress;
            data.head.material.uniforms.uProgress.value = progress;

            const headPositions = data.head.geometry.attributes.position.array;
            headPositions[0] = headX;
            headPositions[1] = headY;
            headPositions[2] = headZ;
            data.head.geometry.attributes.position.needsUpdate = true;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dynamic Camera Animation (Breathing/Drifting)
    // ─────────────────────────────────────────────────────────────────────────

    updateCameraAnimation() {
        if (!this.qualityPreset.enableCameraAnimation) return;

        // ─────────────────────────────────────────────────────────────────────
        // Immersive Breathing Camera Animation
        // Creates a natural, calming "breathing" feel with layered motion
        // ─────────────────────────────────────────────────────────────────────

        // Primary drift period: ~28 seconds, secondary: ~50 seconds
        const driftSpeed = 0.04;
        const slowDrift = 0.022;

        // Horizontal drift with layered motion for organic feel
        // Combined range: ±75 units
        const xDrift = Math.sin(this.time * driftSpeed) * 55
            + Math.sin(this.time * slowDrift * 0.7) * 20;

        // Vertical breathing movement - larger range for noticeable effect
        // Combined range: ±60 units
        const yDrift = Math.sin(this.time * driftSpeed * 0.7 + 1.0) * 40
            + Math.cos(this.time * slowDrift * 0.5) * 20;

        // Depth breathing - gentle forward/back motion
        // Range: ±8 units, period ~20 seconds
        const zDrift = Math.sin(this.time * 0.05) * 8;

        // Apply position drift on top of camera shake
        this.camera.position.x = this.baseCameraPosition.x + xDrift + this.cameraShake.x;
        this.camera.position.y = this.baseCameraPosition.y + yDrift + this.cameraShake.y;
        this.camera.position.z = this.baseCameraPosition.z + zDrift;

        // FOV breathing - subtle zoom in/out for immersive effect
        // Period: ~18 seconds, range: ±1.5 degrees
        const baseFov = 60; // Match the initial perspective camera FOV
        const fovBreath = Math.sin(this.time * 0.08) * 1.5;
        this.camera.fov = baseFov + fovBreath;
        this.camera.updateProjectionMatrix();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW ENHANCED EFFECTS - Phase 2: Ice Crystal Crash (Meteor Crash Equivalent)
    // ─────────────────────────────────────────────────────────────────────────

    createIceCrystalCrash() {
        if (this.isWebGPU) return;
        const maxCrashes = this.qualityPreset.maxIceCrystalCrashes || 0;
        if (this.iceCrystalCrashes.length >= maxCrashes) return;

        // Target random mountain position
        const targetX = (Math.random() - 0.5) * 800; // Constrain to mid-area
        const targetY = -200 + Math.random() * 200; // Mountain base area
        const targetZ = -400 + Math.random() * 200;

        // Start high up
        const startX = targetX + (Math.random() - 0.5) * 400;
        const startY = 800;
        const startZ = targetZ;

        const duration = 0.6; // Fast descent

        // Big crystal head
        const headGeo = new THREE.BufferGeometry();
        headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([startX, startY, startZ]), 3));
        const headMat = new THREE.ShaderMaterial({
            uniforms: { uProgress: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() } },
            vertexShader: iceCrystalHeadVertexShader,
            fragmentShader: iceCrystalHeadFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const head = new THREE.Points(headGeo, headMat);
        head.renderOrder = 300;

        // Trail
        const trailSegments = 20;
        const trailPositions = new Float32Array(trailSegments * 3);
        const trailUvs = new Float32Array(trailSegments);
        for (let i = 0; i < trailSegments; i++) {
            trailPositions[i * 3] = startX; trailPositions[i * 3 + 1] = startY; trailPositions[i * 3 + 2] = startZ;
            trailUvs[i] = i / (trailSegments - 1);
        }
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        trailGeo.setAttribute('aTrailPosition', new THREE.BufferAttribute(trailUvs, 1));
        const trailMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uProgress: { value: 0 } },
            vertexShader: iceCrystalTrailVertexShader,
            fragmentShader: iceCrystalTrailFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const trail = new THREE.Line(trailGeo, trailMat);
        trail.renderOrder = 299;

        const crash = new THREE.Group();
        crash.add(head);
        crash.add(trail);

        crash.userData = {
            phase: 'descent', // descent, explosion
            startTime: this.time,
            duration,
            startX,
            startY,
            startZ,
            targetX,
            targetY,
            targetZ,
            trail,
            head,
            trailPositions,
            exploded: false,
        };

        this.iceCrystalCrashes.push(crash);
        this.scene.add(crash);
    }

    updateIceCrystalCrashes(delta) {
        for (let i = this.iceCrystalCrashes.length - 1; i >= 0; i--) {
            const crash = this.iceCrystalCrashes[i];
            const d = crash.userData;
            const elapsed = this.time - d.startTime;

            if (d.phase === 'descent') {
                const progress = Math.min(elapsed / d.duration, 1.0);

                const curX = d.startX + (d.targetX - d.startX) * progress;
                const curY = d.startY + (d.targetY - d.startY) * progress * progress; // Accelerate
                const curZ = d.startZ + (d.targetZ - d.startZ) * progress;

                // Update head
                const hPos = d.head.geometry.attributes.position.array;
                hPos[0] = curX; hPos[1] = curY; hPos[2] = curZ;
                d.head.geometry.attributes.position.needsUpdate = true;
                d.head.material.uniforms.uProgress.value = progress;

                // Update trail
                const tPos = d.trail.geometry.attributes.position.array;
                // Shift old positions
                for (let k = d.trailPositions.length / 3 - 1; k > 0; k--) {
                    tPos[k * 3] = tPos[(k - 1) * 3];
                    tPos[k * 3 + 1] = tPos[(k - 1) * 3 + 1];
                    tPos[k * 3 + 2] = tPos[(k - 1) * 3 + 2];
                }
                tPos[0] = curX; tPos[1] = curY; tPos[2] = curZ;
                d.trail.geometry.attributes.position.needsUpdate = true;
                d.trail.material.uniforms.uTime.value = this.time;
                d.trail.material.uniforms.uProgress.value = progress;

                if (progress >= 1.0) {
                    this.triggerIceExplosion(d.targetX, d.targetY, d.targetZ);
                    this.scene.remove(crash);
                    d.head.geometry.dispose(); d.head.material.dispose();
                    d.trail.geometry.dispose(); d.trail.material.dispose();
                    this.iceCrystalCrashes.splice(i, 1);
                }
            }
        }
    }

    createFrostSnap(x, y) {
        // Boost bloom for full-screen impact
        if (this.effectState) {
            this.effectState.bloomBoost = 2.0;
            this.effectState.iceWispSurge = 1.0;
        }
        if (this.isWebGPU) return;

        const pCount = 32;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(pCount * 3);
        const vel = new Float32Array(pCount * 3);
        const size = new Float32Array(pCount);

        for (let i = 0; i < pCount; i++) {
            // Z = 20 (Slightly in front)
            pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = 20;

            const angle = Math.random() * 6.28;
            // FAST speed for screen coverage
            const speed = 3.0 + Math.random() * 5.0;

            vel[i * 3] = Math.cos(angle) * speed;
            vel[i * 3 + 1] = Math.sin(angle) * speed;
            // Explode OUT
            vel[i * 3 + 2] = 5.0 + Math.random() * 10.0;

            size[i] = 30 + Math.random() * 40;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aVelocity', new THREE.BufferAttribute(vel, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
            },
            vertexShader: frostSnapVertexShader,
            fragmentShader: frostSnapFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const snap = new THREE.Points(geo, mat);
        snap.userData = { life: 0, maxLife: 0.8 };

        if (!this.tempEffects) this.tempEffects = [];
        this.tempEffects.push(snap);
        this.scene.add(snap);
    }

    triggerIceExplosion(x, y, z) {
        // 1. Shockwave ring
        const ringGeo = new THREE.PlaneGeometry(300, 300);
        const ringMat = new THREE.ShaderMaterial({
            uniforms: { uProgress: { value: 0 }, uOpacity: { value: 1.0 } },
            vertexShader: frostRingShockwaveVertexShader,
            fragmentShader: frostRingShockwaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(x, y + 20, z); // Slightly above ground
        ring.rotation.x = -Math.PI / 2;
        ring.userData = { life: 0, maxLife: 1.2 };

        // Let's create a dedicated array for "temporary effects" to be cleaner
        if (!this.tempEffects) this.tempEffects = [];
        this.tempEffects.push(ring);
        this.scene.add(ring);

        // 2. Debris Shards
        const debrisCount = 40;
        const dGeo = new THREE.BufferGeometry();
        const dPos = new Float32Array(debrisCount * 3);
        const dVel = new Float32Array(debrisCount * 3);
        const dSize = new Float32Array(debrisCount);
        const dRot = new Float32Array(debrisCount);

        for (let i = 0; i < debrisCount; i++) {
            dPos[i * 3] = x; dPos[i * 3 + 1] = y; dPos[i * 3 + 2] = z;
            const theta = Math.random() * 6.28;
            const phi = Math.random() * 3.14 * 0.5; // Upward hemisphere
            const speed = 100 + Math.random() * 200;
            dVel[i * 3] = Math.cos(theta) * Math.sin(phi) * speed;
            dVel[i * 3 + 1] = Math.cos(phi) * speed;
            dVel[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * speed;
            dSize[i] = 10 + Math.random() * 20;
            dRot[i] = Math.random() * 6.28;
        }
        dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
        dGeo.setAttribute('aVelocity', new THREE.BufferAttribute(dVel, 3));
        dGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1));
        dGeo.setAttribute('aRotation', new THREE.BufferAttribute(dRot, 1));

        const dMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() } },
            vertexShader: iceShardDebrisVertexShader,
            fragmentShader: iceShardDebrisFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const debris = new THREE.Points(dGeo, dMat);
        debris.userData = { life: 0, maxLife: 2.5 };
        this.tempEffects.push(debris);
        this.scene.add(debris);

        // 3. Camera Shake Impact
        this.cameraShake.intensity = 15; // Massive shake
        this.flashIntensity = 1.0; // Bright flash
    }

    updateTempEffects(delta) {
        if (!this.tempEffects) return;
        for (let i = this.tempEffects.length - 1; i >= 0; i--) {
            const eff = this.tempEffects[i];
            eff.userData.life += delta;

            if (eff.userData.life >= eff.userData.maxLife) {
                this.scene.remove(eff);
                if (eff.geometry) eff.geometry.dispose();
                if (eff.material) eff.material.dispose();
                this.tempEffects.splice(i, 1);
                continue;
            }

            // Update specific uniforms
            const progress = eff.userData.life / eff.userData.maxLife;
            if (eff.material.uniforms.uProgress) eff.material.uniforms.uProgress.value = progress;
            if (eff.material.uniforms.uTime) eff.material.uniforms.uTime.value = eff.userData.life;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NEW ENHANCED EFFECTS - Phase 3: Blizzard Waves (Line Clear)
    // ─────────────────────────────────────────────────────────────────────────

    createBlizzardWave(direction = 1) { // 1 for left-to-right, -1 for right-to-left
        if (this.isWebGPU) return;
        const maxWaves = this.qualityPreset.maxBlizzardWaves || 0;
        if (this.blizzardWaves.length >= maxWaves) return;

        const pCount = 2000;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(pCount * 3);
        const phase = new Float32Array(pCount);
        const size = new Float32Array(pCount);
        const speed = new Float32Array(pCount);

        for (let i = 0; i < pCount; i++) {
            // Wall of snow
            pos[i * 3] = (Math.random() - 0.5) * 200 - (direction * 800); // Start off-screen
            pos[i * 3 + 1] = (Math.random() - 0.5) * 1000; // Full height
            pos[i * 3 + 2] = (Math.random() - 0.5) * 600 - 200; // Depth

            phase[i] = Math.random() * 6.28;
            size[i] = 5 + Math.random() * 15;
            speed[i] = 1.0 + Math.random() * 0.5;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uDirection: { value: direction },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
            },
            vertexShader: blizzardWaveVertexShader,
            fragmentShader: blizzardWaveFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const wave = new THREE.Points(geo, mat);
        wave.userData = { life: 0, maxLife: 1.5 };
        this.blizzardWaves.push(wave);
        this.scene.add(wave);
    }

    updateBlizzardWaves(delta) {
        for (let i = this.blizzardWaves.length - 1; i >= 0; i--) {
            const wave = this.blizzardWaves[i];
            wave.userData.life += delta;

            if (wave.userData.life >= wave.userData.maxLife) {
                this.scene.remove(wave);
                wave.geometry.dispose(); wave.material.dispose();
                this.blizzardWaves.splice(i, 1);
                continue;
            }

            wave.material.uniforms.uTime.value = this.time;
            wave.material.uniforms.uProgress.value = wave.userData.life / wave.userData.maxLife;
        }
    }

    createFrozenLightningEffect(cx, cy, cz) {
        if (this.isWebGPU) return;
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
            uniforms: { ...FrozenLightningShader.uniforms },
            vertexShader: FrozenLightningShader.vertexShader,
            fragmentShader: FrozenLightningShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.LineSegments(geo, mat);
        mesh.userData = { life: 1.0 };
        this.frozenLightning.push(mesh);
        this.scene.add(mesh);
    }

    createVortexSystem(x, y, z) {
        if (this.isWebGPU) return;
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
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const vortex = new THREE.Points(geometry, material);
        vortex.userData = { life: 1.0 };
        this.vortexSystems.push(vortex);
        this.scene.add(vortex);
    }

    setupPostProcessing() {
        if (!this.qualityPreset.enablePostProcessing) {
            if (this.post) {
                this.post.dispose();
                this.post = null;
            }
            if (this.composer) {
                this.composer.dispose();
                this.composer = null;
            }
            this.bloomPass = null;
            return;
        }

        if (this.isWebGPU) {
            if (this.composer) {
                this.composer.dispose();
                this.composer = null;
            }
            this.bloomPass = null;
            if (this.post) this.post.dispose();

            this.post = new WinterPost(this.renderer, this.scene, this.camera, {
                bloomStrength: this.qualityPreset.bloomStrength,
                bloomRadius: this.qualityPreset.bloomRadius,
                bloomThreshold: 0.85,
                vignetteDarkness: VignetteShader.uniforms.darkness.value,
                vignetteOffset: VignetteShader.uniforms.offset.value,
                gradeStrength: 0.3,
                useMRT: true,
                shaftStrength: 0.25,
                shaftSamples: this.qualityPreset.shaftSamples ?? 4,
                bloomScale: this.qualityPreset.bloomScale ?? 0.6,
            });
            this.post.setSize(window.innerWidth, window.innerHeight);
            if (this.mrtAuditEnabled) {
                this.auditMrtMaterials('PostSetup');
            }
            return;
        }

        if (this.post) {
            this.post.dispose();
            this.post = null;
        }

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            this.qualityPreset.bloomRadius,
            0.85,
        );
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(new ShaderPass(VignetteShader));
    }

    setupEventListeners() {
        this.eventUnsubscribers.forEach((u) => u()); this.eventUnsubscribers = [];
        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.LINE_CLEAR, (d) => this.handleLineClear(d)),
            eventBus.on(EVENTS.COMBO, (d) => this.handleCombo(d)),
            eventBus.on(EVENTS.PIECE_LOCK, (d) => this.handlePieceLock(d)),
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

    handlePieceLock(data) {
        this.cameraShake.intensity += 0.5;
        this.cameraShake.intensity = Math.min(this.cameraShake.intensity, 2.5);

        // === NEW: Frost Snap Effect ===
        if (data && this.qualityPreset.iceWispCount > 0) {
            const { piece } = data;
            // Fallback to data directly if properties exist on it (legacy support)
            const obj = piece || data;

            // Check for positions array (from previous assumption) or x/y from piece
            let wx = 0; let
                wy = 0;

            if (obj.positions) {
                let avgX = 0; let
                    avgY = 0;
                obj.positions.forEach((p) => { avgX += p.x; avgY += p.y; });
                avgX /= obj.positions.length;
                avgY /= obj.positions.length;
                // Scale 4.0 ensures bottom of board isn't cut off at Z=20
                wx = (avgX - 4.5) * 4.0;
                wy = (10 - avgY) * 4.0 - 2.0;
            } else if (typeof obj.x === 'number' && typeof obj.y === 'number') {
                const cx = obj.x + 1.5;
                const cy = obj.y + 1.5;
                wx = (cx - 4.5) * 4.0;
                wy = (10 - cy) * 4.0 - 2.0;
            } else {
                // Last resort fallback
                console.warn('[Winter] Piece Lock data missing coords:', data);
                return;
            }

            console.log(`[Winter] Frost Snap at (${wx.toFixed(1)}, ${wy.toFixed(1)})`);
            this.createFrostSnap(wx, wy);
        }
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

        // === NEW: Blizzard Wave on big clear ===
        if (lines >= 2 || combo >= 2) {
            this.createBlizzardWave(Math.random() > 0.5 ? 1 : -1);
        }

        // === NEW: Aurora Pulse Wave ===
        // (Will implement aurora pulse logic in update loop if needed,
        //  but simpler to just boost intensity here for now)
        if (this.effectState) {
            this.effectState.auroraBoost = 1.0; // Decay handled in update
        }

        if (combo >= 4) {
            this.createVortexSystem(0, 0, -200);

            // === NEW: Ice Crystal Crash on High Combo ===
            if (combo >= 6) {
                this.createIceCrystalCrash();
            }
            // === NEW: Shooting Star on Medium Combo ===
            else if (combo >= 3) {
                this.createShootingStar();
            }
        }

        this.flashIntensity = 0.5 + Math.min(combo * 0.1, 1.0);
        this.cameraShake.intensity = Math.min(3 + lines + combo * 1.5, 12);

        // AURORA REACTS TO COMBO
        if (this.auroraLayers.length > 0) {
            this.auroraLayers.forEach((l) => {
                const u = l.userData?.uniforms || l.material.uniforms;
                if (u?.uIntensity) u.uIntensity.value = 1.5 + Math.min(combo, 2.0);
            });
        }
    }

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;
            const delta = this.clock.getDelta();
            this.time += delta;
            if (this.baselineEnabled) {
                this.trackBaseline(delta);
            }
            this.updatePerformance(delta);

            // Updates
            this.updateEffectState(delta);
            this.updateSnowParticles(delta);
            this.updateCloseSnowflakes(delta);
            this.updateIceBurst(delta);
            this.updateFrozenLightning(delta);
            this.updateVortexes(delta);

            // === NEW ENHANCED EFFECT UPDATES ===
            this.updateShootingStars();
            this.updateCameraAnimation();
            this.updateIceCrystalCrashes(delta);
            this.updateBlizzardWaves(delta);
            this.updateTempEffects(delta);
            this.updateMoonEffects(delta);

            // Updated Uniforms
            if (this.snowParticles) {
                const u = this.snowUniforms || this.snowParticles.material.uniforms;
                if (u?.uTime) u.uTime.value = this.time;
                if (u?.uWindForce) u.uWindForce.value = this.windForce;
                if (u?.uGustIntensity) u.uGustIntensity.value = this.gustIntensity;
                if (u?.uFlashIntensity) u.uFlashIntensity.value = this.flashIntensity;
            }
            if (this.windStreaks) {
                const u = this.windStreakUniforms || this.windStreaks.material.uniforms;
                if (u?.uTime) u.uTime.value = this.time;
                if (u?.uWindForce) u.uWindForce.value = this.windForce;
                const spd = Math.abs(this.windForce);
                if (u?.uOpacity) {
                    u.uOpacity.value = Math.min(Math.max((spd - 10.0) / 20.0, 0.0), 0.8) * this.gustIntensity;
                }
            }
            this.auroraLayers.forEach((layer) => {
                const u = layer.userData?.uniforms || layer.material.uniforms;
                if (u?.uTime) u.uTime.value = this.time;
                if (u?.uIntensity && u.uIntensity.value > 1.0) u.uIntensity.value -= delta * 0.5;
            });
            if (this.starUniforms?.uTime) {
                this.starUniforms.uTime.value = this.time;
            } else if (this.starfield?.material?.uniforms?.uTime) {
                this.starfield.material.uniforms.uTime.value = this.time;
            }
            if (this.closeSnowflakeUniforms?.uTime) {
                this.closeSnowflakeUniforms.uTime.value = this.time;
            }
            if (this.closeSnowflakeUniforms?.uOpacity) {
                this.closeSnowflakeUniforms.uOpacity.value = Math.min(1.0, 0.55 + this.flashIntensity * 0.5);
            }

            // === NEW: Ice Wisps uniforms ===
            if (this.iceWisps) {
                const u = this.iceWispUniforms || this.iceWisps.material.uniforms;
                if (u?.uTime) u.uTime.value = this.time;
                if (u?.uSurgeIntensity) u.uSurgeIntensity.value = this.effectState.iceWispSurge;
            }

            // === NEW: Fog layers uniforms ===
            this.fogLayers.forEach((layer) => {
                const u = layer.userData?.uniforms || layer.material.uniforms;
                if (u?.uTime) u.uTime.value = this.time;
            });

            if (this.post?.updateParams) {
                const params = {
                };
                if (this.moon && this.camera) {
                    this.moon.getWorldPosition(this._moonScreen);
                    this._moonScreen.project(this.camera);
                    this._moonUv.set(this._moonScreen.x * 0.5 + 0.5, this._moonScreen.y * 0.5 + 0.5);
                    params.lightPos = this._moonUv;
                    params.shaftStrength = (0.25 + this.flashIntensity * 0.4) * (this.postPerfScale ?? 1.0);
                }
                this.post.updateParams(params);
            }

            if (this.post && this.qualityPreset.enablePostProcessing) {
                if (typeof this.post.updateTime === 'function') {
                    this.post.updateTime(this.time);
                }
                this.post.render();
            } else if (this.composer && this.qualityPreset.enablePostProcessing) {
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
        if (this.effectState) {
            // Decay Bloom Boost
            if (this.effectState.bloomBoost > 0) {
                this.effectState.bloomBoost -= delta * 3.0; // Fast decay
                if (this.effectState.bloomBoost < 0) this.effectState.bloomBoost = 0;

                // Apply to pass
                const base = this.qualityPreset.bloomStrength;
                if (this.bloomPass) {
                    this.bloomPass.strength = base + (this.effectState.bloomBoost * base * 2.0);
                } else if (this.post?.updateParams) {
                    this.post.updateParams({
                        bloomStrength: base + (this.effectState.bloomBoost * base * 2.0),
                    });
                }
            }

            // Decay Ice Wisp Surge
            if (this.effectState.iceWispSurge > 0) {
                this.effectState.iceWispSurge -= delta * 1.0;
                if (this.effectState.iceWispSurge < 0) this.effectState.iceWispSurge = 0;
            }

        }

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
        if (this.isWebGPU && this.snowCompute?.computeNode) {
            if (this.snowUpdateStride > 1) {
                this.snowUpdateAccumulator += delta;
                this.snowUpdateFrame = (this.snowUpdateFrame + 1) % this.snowUpdateStride;
                if (this.snowUpdateFrame !== 0) return;
                delta = this.snowUpdateAccumulator;
                this.snowUpdateAccumulator = 0;
            }
            this.snowCompute.update(this.time, delta, this.windForce, this.gustIntensity);
            this.renderer.compute(this.snowCompute.computeNode);
            return;
        }
        if (this.snowUpdateStride > 1) {
            this.snowUpdateAccumulator += delta;
            this.snowUpdateFrame = (this.snowUpdateFrame + 1) % this.snowUpdateStride;
            if (this.snowUpdateFrame !== 0) return;
            delta = this.snowUpdateAccumulator;
            this.snowUpdateAccumulator = 0;
        }
        const pos = this.snowParticles.geometry.attributes.position.array;
        const vel = this.snowVelocities;
        const b = this.snowBounds;
        const count = this.snowDrawCount || pos.length / 3;
        for (let i = 0; i < count; i++) {
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

    applySnowLod() {
        const lod = this.snowLod;
        if (this.snowParticles) {
            this.snowDrawCount = this.snowMaxCount;
            this.snowParticles.geometry.setDrawRange(0, this.snowDrawCount);
        }
        if (this.closeSnowflakes) {
            const maxCount = this.closeSnowflakeMaxCount || this.closeSnowflakes.count || 0;
            this.closeSnowflakes.count = maxCount;
        }
        if (this.isWebGPU && this.snowCompute && this.snowMaxCount) {
            if (this.snowCompute.count !== this.snowMaxCount) {
                this.snowCompute.setActiveCount(this.snowMaxCount);
            }
        }

        if (this.windStreaks?.geometry) {
            const max = this.windStreakMaxCount || this.windStreaks.geometry.attributes.position.count;
            const active = Math.max(4, Math.floor(max * (0.35 + 0.65 * lod)));
            this.windStreaks.geometry.setDrawRange(0, active);
        }

        if (this.starfield?.geometry) {
            const max = this.starMaxCount || this.starfield.geometry.attributes.position.count;
            const active = Math.max(1500, Math.floor(max * (0.4 + 0.6 * lod)));
            this.starfield.geometry.setDrawRange(0, active);
        }

        if (this.iceWisps?.geometry && this.iceWispMaxCount && this.iceWispTrailSegments) {
            const activeWisps = Math.max(1, Math.floor(this.iceWispMaxCount * (0.35 + 0.65 * lod)));
            const drawCount = Math.min(
                this.iceWispMaxCount * this.iceWispTrailSegments,
                activeWisps * this.iceWispTrailSegments,
            );
            this.iceWisps.geometry.setDrawRange(0, drawCount);
        }

        if (this.auroraLayers?.length) {
            const max = this.auroraLayers.length;
            const visibleCount = Math.max(1, Math.round(max * (0.35 + 0.65 * lod)));
            this.auroraLayers.forEach((layer, i) => { layer.visible = i < visibleCount; });
        }

        if (this.fogLayers?.length) {
            const max = this.fogLayers.length;
            const visibleCount = Math.max(0, Math.round(max * (0.25 + 0.75 * lod)));
            this.fogLayers.forEach((layer, i) => { layer.visible = i < visibleCount; });
        }

        if (this.post?.updateParams) {
            const baseScale = this.qualityPreset.bloomScale ?? 0.6;
            const perfScale = 0.5 + 0.5 * lod;
            this.post.updateParams({ bloomScale: baseScale * perfScale });
            this.postPerfScale = 0.4 + 0.6 * lod;
        }

        if (this.renderer && this.basePixelRatio) {
            const nextScale = Math.max(0.6, Math.min(1.0, 0.6 + 0.4 * lod));
            if (Math.abs(nextScale - this.pixelRatioScale) > 0.01) {
                this.pixelRatioScale = nextScale;
                this.renderer.setPixelRatio(this.basePixelRatio * this.pixelRatioScale);
                this.renderer.setSize(window.innerWidth, window.innerHeight);
                if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
                if (this.post && typeof this.post.setSize === 'function') {
                    this.post.setSize(window.innerWidth, window.innerHeight);
                }
            }
        }

        if (lod < 0.4) {
            this.snowUpdateStride = 4;
            this.closeSnowflakeFrameStride = 4;
        } else if (lod < 0.55) {
            this.snowUpdateStride = 3;
            this.closeSnowflakeFrameStride = 3;
        } else if (lod < 0.75) {
            this.snowUpdateStride = 2;
            this.closeSnowflakeFrameStride = 2;
        } else {
            this.snowUpdateStride = 1;
            this.closeSnowflakeFrameStride = 1;
        }
    }

    updatePerformance(delta) {
        const frameMs = delta * 1000;
        this.frameTimeMs = this.frameTimeMs * 0.8 + frameMs * 0.2;
        this.lodAdjustTimer += delta;
        if (this.lodAdjustTimer < 0.5) return;

        const slowThreshold = this.targetFrameTime * 1.05;
        const fastThreshold = this.targetFrameTime * 0.85;
        const minLod = this.targetFrameTime <= 9 ? 0.3 : 0.45;
        let changed = false;

        if (this.frameTimeMs > slowThreshold) {
            const next = Math.max(minLod, this.snowLod - 0.15);
            if (next !== this.snowLod) {
                this.snowLod = next;
                changed = true;
            }
        } else if (this.frameTimeMs < fastThreshold) {
            const next = Math.min(1.0, this.snowLod + 0.05);
            if (next !== this.snowLod) {
                this.snowLod = next;
                changed = true;
            }
        }

        if (changed) this.applySnowLod();
        this.lodAdjustTimer = 0;
    }

    trackBaseline(delta) {
        const frameMs = delta * 1000;
        this.baselineFrames.push(frameMs);
        if (this.baselineFrames.length > this.baselineMaxFrames) {
            this.baselineFrames.shift();
        }
    }

    resetBaseline() {
        this.baselineFrames = [];
    }

    reportBaseline() {
        if (!this.baselineFrames.length) {
            console.log('[WinterBaseline] No frames collected yet.');
            return null;
        }
        const frames = [...this.baselineFrames].sort((a, b) => a - b);
        const avgMs = this.baselineFrames.reduce((a, b) => a + b, 0) / this.baselineFrames.length;
        const avgFps = 1000 / avgMs;
        const p99Index = Math.max(0, Math.floor(frames.length * 0.99) - 1);
        const p99Ms = frames[p99Index];
        const low1Fps = 1000 / p99Ms;
        const report = {
            backend: this.isWebGPU ? 'WebGPU' : 'WebGL',
            preset: this.currentQuality,
            avgFps: Number(avgFps.toFixed(1)),
            p99Ms: Number(p99Ms.toFixed(2)),
            low1Fps: Number(low1Fps.toFixed(1)),
            frames: this.baselineFrames.length,
            snowLod: this.snowLod,
        };
        console.log('[WinterBaseline] Report:', report);
        return report;
    }

    captureBaseline(label = 'winter') {
        if (!this.renderer?.domElement) {
            console.warn('[WinterBaseline] No renderer canvas available.');
            return;
        }
        const canvas = this.renderer.domElement;
        const name = `${label}-${this.isWebGPU ? 'webgpu' : 'webgl'}-${Date.now()}.png`;
        if (canvas.toBlob) {
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = name;
                link.click();
                URL.revokeObjectURL(url);
            });
        } else {
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = name;
            link.click();
        }
    }

    updateCloseSnowflakes(delta) {
        if (!this.closeSnowflakes || !this.closeSnowflakeData || !this.camera) return;
        if (this.closeSnowflakeFrameStride > 1) {
            this.closeSnowflakeAccumulator += delta;
            this.closeSnowflakeFrame = (this.closeSnowflakeFrame + 1) % this.closeSnowflakeFrameStride;
            if (this.closeSnowflakeFrame !== 0) return;
            delta = this.closeSnowflakeAccumulator;
            this.closeSnowflakeAccumulator = 0;
        }
        const {
            positions,
            velocities,
            sizes,
            depths,
            phases,
            wobbleSpeeds,
            rotations,
            rotationSpeeds,
            bounds,
            dummy,
        } = this.closeSnowflakeData;
        const camQuat = this.camera.quaternion;
        const count = this.closeSnowflakes.count ?? sizes.length;

        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            positions[i3] += velocities[i3] * delta;
            positions[i3 + 1] += velocities[i3 + 1] * delta;
            positions[i3 + 2] += velocities[i3 + 2] * delta;
            rotations[i] += rotationSpeeds[i] * delta;

            if (
                positions[i3 + 1] < -bounds.height * 0.6
                || Math.abs(positions[i3]) > bounds.width
                || positions[i3 + 2] > 50
                || positions[i3 + 2] < -bounds.depth
            ) {
                positions[i3] = (Math.random() - 0.5) * bounds.width;
                positions[i3 + 1] = bounds.height * 0.5 + Math.random() * 120;
                positions[i3 + 2] = -50 - Math.random() * bounds.depth;
                velocities[i3] = 0;
                velocities[i3 + 1] = -(15 + Math.random() * 25);
                velocities[i3 + 2] = 0;
                sizes[i] = 2 + Math.random() * 5;
                depths[i] = Math.random();
                phases[i] = Math.random() * Math.PI * 2;
                wobbleSpeeds[i] = 1.0 + Math.random();
                rotations[i] = Math.random() * Math.PI * 2;
            }

            const depth = depths[i];
            const phase = phases[i];
            const wobbleSpeed = wobbleSpeeds[i];
            const windX = this.windForce * (1.0 + depth);
            const turbulenceWave = Math.sin(positions[i3 + 1] * 0.05 + this.time * 4.0);
            const hardTurbulence = Math.sign(turbulenceWave) * Math.pow(Math.abs(turbulenceWave), 0.5);
            const turbulence = hardTurbulence * this.gustIntensity * 25.0;
            const spiral = Math.sin(this.time * wobbleSpeed + phase) * (2.0 + this.gustIntensity * 5.0);
            const zOffset = Math.cos(this.time * wobbleSpeed * 0.5) * 2.0 - this.windForce * 0.1;
            dummy.position.set(
                positions[i3] + windX + turbulence + spiral,
                positions[i3 + 1],
                positions[i3 + 2] + zOffset,
            );
            dummy.quaternion.copy(camQuat);
            dummy.rotateZ(rotations[i]);
            const boost = 1 + this.flashIntensity * 0.4;
            dummy.scale.set(sizes[i] * boost, sizes[i] * boost, 1);
            dummy.updateMatrix();
            this.closeSnowflakes.setMatrixAt(i, dummy.matrix);
        }

        this.closeSnowflakes.instanceMatrix.needsUpdate = true;
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
                if (v.material.uniforms.uTime) v.material.uniforms.uTime.value = this.time;
                if (v.material.uniforms.uIntensity) v.material.uniforms.uIntensity.value = v.userData.life;
            }
            if (v.userData.life <= 0) {
                this.scene.remove(v); v.geometry.dispose(); v.material.dispose(); this.vortexSystems.splice(i, 1);
            }
        }
    }

    resize(w, h) {
        if (!this.renderer || !this.camera) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        if (this.composer) this.composer.setSize(w, h);
        if (this.post && typeof this.post.setSize === 'function') this.post.setSize(w, h);
        if (this.iceWispUniforms?.uPixelRatio) {
            this.iceWispUniforms.uPixelRatio.value = this.renderer.getPixelRatio();
        }
    }

    stop() {
        if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
        this.eventUnsubscribers.forEach((u) => u());
        super.stop();
    }

    cleanup() {
        this.stop();
        if (typeof window !== 'undefined' && window.winterBaseline) {
            delete window.winterBaseline;
        }
        if (this.snowflakeTexture) this.snowflakeTexture.dispose();
        if (this.closeSnowflakes) {
            this.scene.remove(this.closeSnowflakes);
            if (this.closeSnowflakes.geometry) this.closeSnowflakes.geometry.dispose();
            if (this.closeSnowflakes.material) this.closeSnowflakes.material.dispose();
            this.closeSnowflakes = null;
            this.closeSnowflakeData = null;
            this.closeSnowflakeUniforms = null;
        }
        if (this.snowCompute) {
            this.snowCompute.dispose();
            this.snowCompute = null;
        }
        if (this.post) {
            this.post.dispose();
            this.post = null;
        }
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }
        // ... (standard dispose)
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        super.cleanup();
    }
}
