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
import * as THREE_WEBGPU from 'three/webgpu';
import { TimestampQuery } from 'three/webgpu';
import { mrt, vec3 } from 'three/tsl';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BLACK_HOLE_TETROMINOS } from './black-hole-tetrominos.js';
import { BlackHolePost } from './black-hole-post.js';
import { BlackHoleParticleCompute, BlackHoleBurstCompute, BlackHoleLensingCompute } from './black-hole-compute.js';
import {
    createBlackHoleCoreNodeMaterial,
    createAccretionDiskNodeMaterial,
    createVolumetricAccretionDiskNodeMaterial,
    createStarfieldNodeMaterial,
    createParticleNodeMaterial,
    createBurstSparkNodeMaterial,
    createNebulaCloudNodeMaterial,
    createEventHorizonNodeMaterial,
    createHawkingRadiationNodeMaterial,
    createPhotonSphereNodeMaterial,
} from './black-hole-materials.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 3000,
        particleCount: 16000,
        nebulaCount: 25,
        diskSegments: 128,
        burstSparkCount: 14000,
        bloomStrength: 0.6,
        bloomRadius: 0.8,
        enablePostProcessing: true,
    },
    Ultra: {
        starCount: 2500,
        particleCount: 13000,
        nebulaCount: 20,
        diskSegments: 96,
        burstSparkCount: 11000,
        bloomStrength: 0.55,
        bloomRadius: 0.7,
        enablePostProcessing: true,
    },
    High: {
        starCount: 2000,
        particleCount: 10000,
        nebulaCount: 15,
        diskSegments: 64,
        burstSparkCount: 8500,
        bloomStrength: 0.5,
        bloomRadius: 0.6,
        enablePostProcessing: true,
    },
    Medium: {
        starCount: 1200,
        particleCount: 7000,
        nebulaCount: 10,
        diskSegments: 48,
        burstSparkCount: 6000,
        bloomStrength: 0.4,
        bloomRadius: 0.5,
        enablePostProcessing: true,
    },
    Low: {
        starCount: 600,
        particleCount: 3500,
        nebulaCount: 6,
        diskSegments: 32,
        burstSparkCount: 3200,
        bloomStrength: 0.3,
        bloomRadius: 0.4,
        enablePostProcessing: false,
    },
    Minimal: {
        starCount: 300,
        particleCount: 1800,
        nebulaCount: 4,
        diskSegments: 24,
        burstSparkCount: 1800,
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
// Volumetric Accretion Disk Shader (lightweight raymarch)
// ─────────────────────────────────────────────────────────────────────────────
const VolumetricAccretionDiskShader = {
    uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.35 },
        uRotationSpeed: { value: 1.0 },
        uCenter: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: `
        varying vec3 vWorldPos;
        void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uRotationSpeed;
        uniform vec3 uCenter;
        varying vec3 vWorldPos;

        void main() {
            vec3 normal = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
            vec3 viewDir = normalize(vWorldPos - cameraPosition);

            vec3 baseToCenter = vWorldPos - uCenter;
            float baseHeight = dot(baseToCenter, normal);
            vec3 baseRadial = baseToCenter - normal * baseHeight;
            float baseRadialDist = length(baseRadial);
            float baseAngle = atan(baseRadial.y, baseRadial.x);

            const int STEPS = 10;
            float thickness = 50.0;
            float stepSize = thickness / float(STEPS);

            float accum = 0.0;
            for (int i = 0; i < STEPS; i++) {
                float offset = (float(i) - float(STEPS - 1) * 0.5) * stepSize;
                vec3 p = vWorldPos + viewDir * offset;
                vec3 toCenter = p - uCenter;
                float height = dot(toCenter, normal);
                vec3 radialVec = toCenter - normal * height;
                float radial = length(radialVec);

                float radialMask = smoothstep(140.0, 170.0, radial)
                    * (1.0 - smoothstep(360.0, 400.0, radial));
                float heightFalloff = exp(-height * height * 0.02);
                float swirl = 0.6 + 0.4 * sin(atan(radialVec.y, radialVec.x) * 6.0 + uTime * uRotationSpeed * 0.8);

                accum += radialMask * heightFalloff * swirl;
            }

            float radialT = clamp(baseRadialDist / 400.0, 0.0, 1.0);
            vec3 baseColor = mix(vec3(1.0, 0.9, 0.7), vec3(0.8, 0.35, 0.1), radialT);
            float doppler = sin(baseAngle) * 0.15;
            baseColor = mix(baseColor, vec3(0.6, 0.7, 1.0), max(0.0, doppler));
            baseColor = mix(baseColor, vec3(0.9, 0.2, 0.05), max(0.0, -doppler));

            float intensity = accum * uIntensity * 0.18;
            gl_FragColor = vec4(baseColor * intensity, intensity);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Color Grading Shader (Filmic + subtle tone mastering)
// ─────────────────────────────────────────────────────────────────────────────
const ColorGradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        exposure: { value: 1.05 },
        contrast: { value: 1.04 },
        saturation: { value: 1.08 },
        tint: { value: new THREE.Vector3(1.04, 0.98, 1.08) },
        tintStrength: { value: 0.22 },
        ditherStrength: { value: 0.0025 },
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
        uniform float exposure;
        uniform float contrast;
        uniform float saturation;
        uniform vec3 tint;
        uniform float tintStrength;
        uniform float ditherStrength;
        varying vec2 vUv;

        vec3 acesToneMap(vec3 x) {
            return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 color = texel.rgb * exposure;
            color = acesToneMap(color);

            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, saturation);
            color = (color - 0.5) * contrast + 0.5;
            color = mix(color, color * tint, tintStrength);

            float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            color += (noise - 0.5) * ditherStrength;
            color = clamp(color, 0.0, 1.0);

            gl_FragColor = vec4(color, texel.a);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// WebGPU Upgrade Helpers
// ─────────────────────────────────────────────────────────────────────────────
function parseBlackHoleFlags() {
    if (typeof window === 'undefined') {
        return {
            forceWebGL: false,
            noCompute: false,
            noMRT: false,
            noLensing: false,
            noPost: false,
            noUnified: false,
            noVolume: false,
            gpuTimings: false,
            baseline: false,
            seed: null,
            fixedDeltaMs: null,
        };
    }

    const params = new URLSearchParams(window.location.search);
    const seedParam = params.get('blackHoleSeed');
    const fixedDeltaParam = params.get('blackHoleFixedDt');

    const seed = seedParam !== null ? Number(seedParam) : null;
    const fixedDeltaMs = fixedDeltaParam !== null ? Number(fixedDeltaParam) : null;

    return {
        forceWebGL: params.has('forceWebGL'),
        noCompute: params.has('blackHoleNoCompute'),
        noMRT: params.has('blackHoleNoMRT'),
        noLensing: params.has('blackHoleNoLensing'),
        noPost: params.has('blackHoleNoPost'),
        noUnified: params.has('blackHoleNoUnified') || params.has('blackHoleNoUnifiedParticles'),
        noVolume: params.has('blackHoleNoVolume') || params.has('blackHoleNoVolumetric'),
        gpuTimings: params.has('blackHoleGpuTiming'),
        noDrs: params.has('blackHoleNoDRS') || params.has('blackHoleNoDrs'),
        baseline: params.has('blackHoleBaseline'),
        seed: Number.isFinite(seed) ? seed : null,
        fixedDeltaMs: Number.isFinite(fixedDeltaMs) && fixedDeltaMs > 0 ? fixedDeltaMs : null,
    };
}

function createSeededRandom(seed) {
    if (!Number.isFinite(seed)) return Math.random;
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class BlackHoleTheme extends BaseTheme {
    constructor() {
        super('black-hole');

        this.flags = parseBlackHoleFlags();
        this.random = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDeltaMs ? this.flags.fixedDeltaMs / 1000 : null;
        this.isWebGPU = false;
        this.capabilities = {};

        this.dynamicResolution = {
            enabled: !this.flags.noDrs,
            scale: 1.0,
            minScale: 0.7,
            maxScale: 1.0,
            targetMs: 16.6,
            emaMs: 16.6,
            adjustInterval: 0.75,
            elapsed: 0,
        };
        this.lodState = {
            starCount: 0,
            particleCount: 0,
            hawkingCount: 0,
        };

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.postProcessing = null;
        this.particleAttributes = null;
        this.particleCompute = null;
        this.computeBlackHolePos = new THREE.Vector3();
        this.burstCompute = null;
        this.burstSparks = null;
        this.starLensingCompute = null;

        // Scene elements
        this.blackHoleCore = null;
        this.accretionDisk = null;
        this.accretionVolumeLayers = [];
        this.starfield = null;
        this.nebulaClouds = [];
        this.nebulaTexture = null;
        this.particles = null;
        this.hawkingParticles = null;
        this.photonSphere = null;
        this.jetParticles = null;
        this.hawkingAttributes = null;
        this.hawkingVelocities = null;
        this.hawkingLifetimes = null;
        this.hawkingAges = null;
        this.hawkingLifeSpans = null;
        this.hawkingSwirl = null;
        this.hawkingBaseSizes = null;
        this.burstSparksPool = []; // Pool of burst particle systems for overlapping effects
        this.burstPoolSize = 8; // Maximum simultaneous bursts
        this.nextBurstIndex = 0; // Round-robin index for pool allocation
        this.nextBurstParticleIndex = 0; // Ring allocator for combo burst particles
        this.nextJetParticleIndex = 0; // Ring allocator for jet particles
        this.comboSpawnReuseUntil = null; // Per-particle reuse lock to avoid combo overwrite resets

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
        this.hawkingIntensity = 1.0;
        this.hawkingTargetIntensity = 1.0;
        this.photonSpherePulse = 0;
        this.uniformCache = {};
        this.gpuTimings = {
            enabled: false,
            lastResolve: 0,
            compute: {},
        };

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // Black hole drift (floating motion)
        this.blackHoleGroup = null;
        this.driftX = 0;
        this.driftY = 0;
        this.driftPhaseX = this.random() * Math.PI * 2;
        this.driftPhaseY = this.random() * Math.PI * 2;

        // Camera motion state
        this.cameraBasePosition = new THREE.Vector3(0, 200, 800);
        this.cameraTargetPosition = this.cameraBasePosition.clone();
        this.cameraLookTarget = new THREE.Vector3(0, 0, 0);
        this.cameraLookTargetSmoothed = new THREE.Vector3(0, 0, 0);
        this.cameraPhaseX = this.random() * Math.PI * 2;
        this.cameraPhaseY = this.random() * Math.PI * 2;
        this.cameraPhaseZ = this.random() * Math.PI * 2;

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

    probeWebGPUCapabilities() {
        if (!this.renderer || !this.renderer.backend?.isWebGPUBackend) {
            this.capabilities = {
                isWebGPU: false,
                maxColorAttachments: 0,
                supportsTimestampQuery: false,
                supportsFloat32Filterable: false,
            };
            return;
        }

        const backend = this.renderer.backend;
        const device = backend?.device;
        const maxColorAttachments = device?.limits?.maxColorAttachments ?? 0;
        const supportsTimestampQuery = this.renderer.hasFeature?.('timestamp-query') ?? false;
        const supportsFloat32Filterable = this.renderer.hasFeature?.('float32-filterable') ?? false;

        this.capabilities = {
            isWebGPU: true,
            maxColorAttachments,
            supportsTimestampQuery,
            supportsFloat32Filterable,
        };

        if (supportsTimestampQuery && this.flags.gpuTimings && this.renderer?.backend) {
            this.renderer.backend.trackTimestamp = true;
            this.gpuTimings.enabled = true;
            if (this.flags.baseline) {
                console.log('[BlackHole] GPU timestamp queries enabled');
            }
        }

        if (this.flags.baseline) {
            console.log('[BlackHole] WebGPU capability probe', this.capabilities);
        }
    }

    updateCapabilityFlags() {
        const usePost = this.isWebGPU && this.qualityPreset.enablePostProcessing && !this.flags.noPost;
        const supportsMRT = this.capabilities?.maxColorAttachments > 1;
        const useMRT = usePost && !this.flags.noMRT && supportsMRT;
        const useCompute = this.isWebGPU && !this.flags.noCompute;
        const useLensing = useCompute && !this.flags.noLensing;
        const useUnifiedParticles = useCompute && !this.flags.noUnified;

        this.flags.usePost = usePost;
        this.flags.useMRT = useMRT;
        this.flags.useCompute = useCompute;
        this.flags.useLensing = useLensing;
        this.flags.useUnifiedParticles = useUnifiedParticles;
        this.flags.useVolume = !this.flags.noVolume;
        this.flags.useBloom = usePost;
        this.flags.useChromatic = usePost;
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
            || material.isSpriteNodeMaterial
        ) {
            return true;
        }
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    ensureMrtMaterials() {
        if (!this.isWebGPU || !this.scene || !this.flags.useMRT) return;

        const seen = new Set();
        const nonNode = [];
        const patched = [];
        const nodeMaterials = [];
        const zeroEmissive = vec3(0.0, 0.0, 0.0);

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
            nodeMaterials.push(material);
            if (!material.emissiveNode) {
                material.emissiveNode = zeroEmissive;
                patched.push({ objectName, materialName });
            }
            material.mrtNode = mrt({ emissive: material.emissiveNode || zeroEmissive });
            material.needsUpdate = true;
        };

        if (this.scene.material) {
            recordMaterial(this.scene.material, this.scene);
        }
        this.scene.traverse((child) => {
            if (child.material) {
                recordMaterial(child.material, child);
            }
        });

        if (patched.length && this.flags.baseline) {
            console.log('[BlackHole] Patched emissiveNode on MRT materials:', patched);
        }

        if (nonNode.length) {
            nodeMaterials.forEach((material) => {
                material.mrtNode = null;
                material.needsUpdate = true;
            });
            console.warn('[BlackHole] MRT disabled due to non-NodeMaterials:', nonNode);
            this.flags.useMRT = false;
        }
    }

    async createScene() {
        console.log('[BlackHole] Creating 3D scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);
        if (this.dynamicResolution) {
            this.dynamicResolution.enabled = !this.flags.noDrs;
            this.dynamicResolution.scale = 1.0;
            this.dynamicResolution.emaMs = 16.6;
            this.dynamicResolution.elapsed = 0;
        }

        const container = document.getElementById('black-hole-theme');
        if (!container) {
            console.error('[BlackHole] Container not found');
            return;
        }

        // Hide all old CSS-based black hole elements
        this.hideOldDOMElements(container);

        await this.initRenderer(container);
        this.updateCapabilityFlags();

        if (this.flags.baseline) {
            console.log('[BlackHole] Baseline capture enabled', {
                preset: quality,
                backend: this.isWebGPU ? 'WebGPU' : 'WebGL2',
                flags: { ...this.flags },
            });
        }

        this.createStarfield();
        this.createNebulaClouds();
        this.createBlackHoleCore();
        this.createPhotonSphere();
        this.createAccretionDisk();
        this.createParticleSystem();
        this.createHawkingRadiation();
        this.createBurstSparks();
        this.ensureMrtMaterials();
        this.setupPostProcessing();
        this.cacheUniforms();
        this.applyDynamicResolution(window.innerWidth, window.innerHeight);
        this.applyLod();
        this.setupEventListeners();

        if (this.isWebGPU && this.renderer?.compileAsync && !this.flags.useMRT) {
            try {
                await this.renderer.compileAsync(this.scene, this.camera);
            } catch (error) {
                console.warn('[BlackHole] WebGPU compileAsync failed:', error);
            }
        }

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

    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;

        let webgpuRenderer = null;

        if (!this.flags.forceWebGL) {
            webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: false,
            });

            try {
                await webgpuRenderer.init();
            } catch (error) {
                console.warn('[BlackHole] WebGPU init failed, falling back to WebGL2:', error);
                webgpuRenderer.dispose();
                webgpuRenderer = null;
            }
        }

        if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
            this.renderer = webgpuRenderer;
            this.isWebGPU = true;

            this.renderer.onDeviceLost = (info) => {
                console.error('[BlackHole] WebGPU device lost:', info);
            };
        } else {
            if (webgpuRenderer) webgpuRenderer.dispose();
            this.renderer = new THREE.WebGLRenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: false,
            });
            this.isWebGPU = false;
        }

        console.log(`[BlackHole] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

        this.renderer.setClearColor(0x000005, 1); // Very dark blue-black
        this.applyDynamicResolution(width, height);
        this.renderer.sortObjects = true;
        this.renderer.autoClear = false;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Camera looking at center, slightly above for dramatic angle
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraLookTarget);
        this.cameraTargetPosition.copy(this.cameraBasePosition);
        this.cameraLookTargetSmoothed.copy(this.cameraLookTarget);

        // Ambient light (very dim)
        const ambientLight = new THREE.AmbientLight(0x202030, 0.3);
        this.scene.add(ambientLight);

        this.probeWebGPUCapabilities();

        console.log('[BlackHole] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - 3D Points with twinkling
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const { starCount } = this.qualityPreset;
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
            const theta = this.random() * Math.PI * 2;
            const phi = Math.acos(2 * this.random() - 1);
            const radius = 2000 + this.random() * 3000;

            positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = radius * Math.cos(phi) - 2000; // Push back

            const color = starColors[Math.floor(this.random() * starColors.length)];
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1 + this.random() * 3;
            phases[i] = this.random() * Math.PI * 2;
        }

        if (this.starLensingCompute) {
            this.starLensingCompute.dispose();
            this.starLensingCompute = null;
        }

        if (this.isWebGPU && this.flags.useLensing) {
            if (!this.renderer?.compute) {
                this.flags.useLensing = false;
            } else {
                try {
                    this.starLensingCompute = new BlackHoleLensingCompute(starCount);
                    this.starLensingCompute.setInitialState(positions);
                    this.starLensingCompute.createComputeNode();
                } catch (error) {
                    console.warn('[BlackHole] Starfield lensing compute init failed, falling back to static stars:', error);
                    this.starLensingCompute = null;
                    this.flags.useLensing = false;
                }
            }
        }

        if (this.isWebGPU) {
            const material = createStarfieldNodeMaterial({
                isWebGPU: this.isWebGPU,
                starCompute: this.starLensingCompute,
            });
            const sprite = new THREE.Sprite(material);
            sprite.count = starCount;
            sprite.userData.baseCount = starCount;
            sprite.geometry = sprite.geometry.clone();
            sprite.geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3));
            sprite.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
            sprite.geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(sizes, 1));
            sprite.geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));
            sprite.frustumCulled = false;
            this.starfield = sprite;
        } else {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
            geometry.setDrawRange(0, starCount);

            // Custom shader material for twinkling
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uFlashIntensity: { value: 0 },
                    uBlackHolePos: { value: new THREE.Vector2(0, 0) },
                },
                vertexShader: `
                    uniform vec2 uBlackHolePos;
                    attribute float size;
                    attribute float phase;
                    varying vec3 vColor;
                    varying float vPhase;
                    varying vec2 vPos;
                    varying float vStretchZone;
                    
                    void main() {
                        vColor = color;
                        vPhase = phase;
                        vPos = position.xy;
                        float distToCenter = length(vPos - uBlackHolePos);
                        vStretchZone = smoothstep(600.0, 180.0, distToCenter);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (300.0 / -mvPosition.z) * (1.0 + vStretchZone * 0.6);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform float uFlashIntensity;
                    uniform vec2 uBlackHolePos;
                    varying vec3 vColor;
                    varying float vPhase;
                    varying vec2 vPos;
                    varying float vStretchZone;
                    
                    void main() {
                        vec2 toCenter = vPos - uBlackHolePos;
                        float stretch = 1.0 + vStretchZone * 1.2;

                        vec2 dir = normalize(toCenter + vec2(0.0001));
                        vec2 perp = vec2(-dir.y, dir.x);
                        vec2 center = gl_PointCoord - 0.5;
                        float along = dot(center, dir);
                        float across = dot(center, perp);
                        vec2 stretched = vec2(along, across / stretch);

                        float dist = length(stretched);
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
            this.starfield.userData.baseCount = starCount;
        }

        this.scene.add(this.starfield);
        console.log('[BlackHole] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Billboard planes with procedural textures
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
        gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.12)');
        gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.04)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        return new THREE.CanvasTexture(canvas);
    }

    createNebulaClouds() {
        const cloudCount = this.qualityPreset.nebulaCount;

        if (this.nebulaClouds.length) {
            this.nebulaClouds.forEach((cloud) => {
                this.scene.remove(cloud);
                if (cloud.geometry) cloud.geometry.dispose();
                if (cloud.material) cloud.material.dispose();
            });
            this.nebulaClouds = [];
        }

        if (!this.nebulaTexture) {
            this.nebulaTexture = this.createNebulaTexture();
        }

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = this.isWebGPU
            ? createNebulaCloudNodeMaterial(this.nebulaTexture, { useInstanceColor: true })
            : new THREE.MeshBasicMaterial({
                map: this.nebulaTexture,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
                vertexColors: true,
            });

        const instanced = new THREE.InstancedMesh(geometry, material, cloudCount);
        instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instanced.frustumCulled = false;
        instanced.renderOrder = -10;

        const colors = new Float32Array(cloudCount * 3);
        instanced.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

        const tempMatrix = new THREE.Matrix4();
        const tempPosition = new THREE.Vector3();
        const tempScale = new THREE.Vector3();
        const tempQuaternion = new THREE.Quaternion();
        const tempEuler = new THREE.Euler();
        const tempColor = new THREE.Color();

        for (let i = 0; i < cloudCount; i++) {
            const size = 1500 + this.random() * 2000;

            tempPosition.set(
                (this.random() - 0.5) * 4000,
                (this.random() - 0.5) * 2000,
                -1000 - this.random() * 1500,
            );

            tempEuler.set(0, 0, this.random() * Math.PI);
            tempQuaternion.setFromEuler(tempEuler);
            tempScale.set(size, size, 1);

            tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
            instanced.setMatrixAt(i, tempMatrix);

            const colorType = this.random();
            let hue;
            let sat;
            let light;
            if (colorType < 0.25) {
                hue = 280 + this.random() * 40;
                sat = 0.8;
                light = 0.42;
            } else if (colorType < 0.5) {
                hue = 320 + this.random() * 40;
                sat = 0.85;
                light = 0.46;
            } else if (colorType < 0.75) {
                hue = 180 + this.random() * 40;
                sat = 0.75;
                light = 0.42;
            } else {
                hue = 20 + this.random() * 30;
                sat = 0.8;
                light = 0.45;
            }

            tempColor.setHSL(hue / 360, sat, light);
            colors[i * 3] = tempColor.r;
            colors[i * 3 + 1] = tempColor.g;
            colors[i * 3 + 2] = tempColor.b;
        }

        instanced.instanceMatrix.needsUpdate = true;
        instanced.instanceColor.needsUpdate = true;

        this.nebulaClouds.push(instanced);
        this.scene.add(instanced);

        console.log('[BlackHole] Nebula clouds created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Black Hole Core - Raymarched sphere with event horizon
    // ─────────────────────────────────────────────────────────────────────────

    createBlackHoleCore() {
        const geometry = new THREE.PlaneGeometry(600, 600);
        const material = this.isWebGPU
            ? createBlackHoleCoreNodeMaterial()
            : new THREE.ShaderMaterial({
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
        const blackMaterial = this.isWebGPU
            ? createEventHorizonNodeMaterial()
            : new THREE.MeshBasicMaterial({
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
    // Photon Sphere - Enhanced glow ring
    // ─────────────────────────────────────────────────────────────────────────

    createPhotonSphere() {
        if (this.photonSphere) {
            this.scene.remove(this.photonSphere);
            if (this.photonSphere.geometry) this.photonSphere.geometry.dispose();
            if (this.photonSphere.material) this.photonSphere.material.dispose();
            this.photonSphere = null;
        }

        const geometry = new THREE.RingGeometry(135, 175, 128);
        const material = this.isWebGPU
            ? createPhotonSphereNodeMaterial()
            : new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uIntensity: { value: 1.0 },
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
                    uniform float uIntensity;
                    varying vec2 vUv;

                    void main() {
                        vec2 centered = vUv - 0.5;
                        float radial = length(centered);
                        float ringCenter = 0.42;
                        float ringWidth = 0.06;
                        float ringDist = (radial - ringCenter) / ringWidth;
                        float ring = exp(-ringDist * ringDist);
                        float shimmer = 0.85 + 0.2 * sin(uTime * 2.0 + centered.x * 12.0 + centered.y * 7.0);
                        vec3 warm = vec3(1.0, 0.85, 0.6);
                        vec3 cool = vec3(0.6, 0.75, 1.0);
                        vec3 color = mix(warm, cool, smoothstep(0.35, 0.55, radial));
                        float intensity = ring * shimmer * uIntensity;
                        gl_FragColor = vec4(color * intensity, intensity);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });

        this.photonSphere = new THREE.Mesh(geometry, material);
        this.photonSphere.position.set(0, 0, 0);
        this.photonSphere.renderOrder = 98;
        this.scene.add(this.photonSphere);

        console.log('[BlackHole] Photon sphere created');
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

        const material = this.isWebGPU
            ? createAccretionDiskNodeMaterial()
            : new THREE.ShaderMaterial({
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
        const glowMaterial = this.isWebGPU ? createAccretionDiskNodeMaterial() : material.clone();
        glowMaterial.blending = THREE.AdditiveBlending;
        if (glowMaterial.uniforms?.uIntensity) {
            glowMaterial.uniforms.uIntensity.value = 0.3;
        } else if (glowMaterial.userData?.uIntensity) {
            glowMaterial.userData.uIntensity.value = 0.3;
        }
        const glowDisk = new THREE.Mesh(geometry.clone(), glowMaterial);
        glowDisk.rotation.x = -Math.PI * 0.42;
        glowDisk.scale.set(1.1, 1.1, 1.1);
        glowDisk.renderOrder = 49;
        this.scene.add(glowDisk);
        this.innerDisk = glowDisk;

        // Volumetric haze layers - raymarched disk when enabled (fallback to stacked rings)
        if (this.accretionVolumeLayers.length) {
            this.accretionVolumeLayers.forEach((layer) => {
                this.scene.remove(layer);
                if (layer.geometry) layer.geometry.dispose();
                if (layer.material) layer.material.dispose();
            });
            this.accretionVolumeLayers = [];
        }

        if (this.flags.useVolume) {
            const volumeMaterial = this.isWebGPU
                ? createVolumetricAccretionDiskNodeMaterial()
                : new THREE.ShaderMaterial({
                    uniforms: { ...VolumetricAccretionDiskShader.uniforms },
                    vertexShader: VolumetricAccretionDiskShader.vertexShader,
                    fragmentShader: VolumetricAccretionDiskShader.fragmentShader,
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                    side: THREE.DoubleSide,
                });
            const volume = new THREE.Mesh(geometry.clone(), volumeMaterial);
            volume.rotation.x = -Math.PI * 0.42;
            volume.scale.set(1.08, 1.08, 1.0);
            volume.renderOrder = 48;
            this.accretionVolumeLayers.push(volume);
            this.scene.add(volume);
        } else {
            const volumeCount = 3;
            for (let i = 0; i < volumeCount; i++) {
                const layerMaterial = this.isWebGPU ? createAccretionDiskNodeMaterial() : material.clone();
                const intensity = 0.18 + i * 0.08;
                if (layerMaterial.uniforms?.uIntensity) {
                    layerMaterial.uniforms.uIntensity.value = intensity;
                } else if (layerMaterial.userData?.uIntensity) {
                    layerMaterial.userData.uIntensity.value = intensity;
                }
                layerMaterial.blending = THREE.AdditiveBlending;
                layerMaterial.depthWrite = false;

                const layer = new THREE.Mesh(geometry.clone(), layerMaterial);
                layer.rotation.x = -Math.PI * 0.42;
                layer.position.z = (i - 1) * 8;
                layer.scale.set(1.05 + i * 0.02, 1.05 + i * 0.02, 1.0);
                layer.renderOrder = 48 - i;
                this.accretionVolumeLayers.push(layer);
                this.scene.add(layer);
            }
        }

        console.log('[BlackHole] Accretion disk created');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Particle System - Stardust being pulled into black hole
    // ─────────────────────────────────────────────────────────────────────────

    createParticleSystem() {
        const { particleCount } = this.qualityPreset;
        const positions = new Float32Array(particleCount * 3);
        const velocities = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const lifetimes = new Float32Array(particleCount);
        const randoms = this.isWebGPU && this.flags.useCompute ? new Float32Array(particleCount) : null;

        const particleColors = [
            new THREE.Color(0xff66aa), // Pink
            new THREE.Color(0x66aaff), // Cyan
            new THREE.Color(0xffaa66), // Orange
            new THREE.Color(0xaa66ff), // Purple
            new THREE.Color(0x66ffaa), // Green
        ];

        for (let i = 0; i < particleCount; i++) {
            this.initParticle(i, positions, velocities, colors, sizes, lifetimes, particleColors);
            if (randoms) {
                const seed = (this.flags.seed ?? 0) + i * 12.9898;
                const value = Math.sin(seed) * 43758.5453;
                randoms[i] = value - Math.floor(value);
            }
        }

        if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }
        if (this.isWebGPU && this.flags.useCompute) {
            try {
                this.particleCompute = new BlackHoleParticleCompute(particleCount);
                this.particleCompute.setInitialState(positions, velocities, colors, sizes, lifetimes, randoms);
                this.particleCompute.createComputeNode();
            } catch (error) {
                console.warn('[BlackHole] Particle compute init failed, falling back to CPU:', error);
                this.particleCompute = null;
                this.flags.useCompute = false;
                this.flags.useLensing = false;
            }
        }

        if (this.isWebGPU) {
            const material = createParticleNodeMaterial({
                isWebGPU: this.isWebGPU,
                particleCompute: this.particleCompute,
            });
            const sprite = new THREE.Sprite(material);
            sprite.count = particleCount;
            sprite.userData.baseCount = particleCount;
            sprite.geometry = sprite.geometry.clone();
            sprite.geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3));
            sprite.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
            sprite.geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(sizes, 1));
            sprite.geometry.setAttribute('instanceLifetime', new THREE.InstancedBufferAttribute(lifetimes, 1));
            sprite.frustumCulled = false;

            this.particles = sprite;
            this.particleAttributes = {
                position: sprite.geometry.getAttribute('instancePosition'),
                color: sprite.geometry.getAttribute('instanceColor'),
                size: sprite.geometry.getAttribute('instanceSize'),
                lifetime: sprite.geometry.getAttribute('instanceLifetime'),
            };
        } else {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
            geometry.setDrawRange(0, particleCount);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uIntensity: { value: 1.0 },
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
            this.particles.userData.baseCount = particleCount;
            this.particleAttributes = {
                position: geometry.getAttribute('position'),
                color: geometry.getAttribute('color'),
                size: geometry.getAttribute('size'),
                lifetime: geometry.getAttribute('lifetime'),
            };
        }

        this.particleVelocities = velocities;
        this.particleLifetimes = lifetimes;
        this.particleColors = particleColors;
        this.comboSpawnReuseUntil = new Float32Array(particleCount);
        this.nextBurstParticleIndex = 0;
        this.nextJetParticleIndex = 0;
        this.scene.add(this.particles);

        console.log('[BlackHole] Particle system created with', particleCount, 'particles');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Hawking Radiation - Subtle particle emission near event horizon
    // ─────────────────────────────────────────────────────────────────────────

    getHawkingParticleCount() {
        const base = Math.floor(this.qualityPreset.particleCount * 0.08);
        return Math.max(120, Math.min(1200, base));
    }

    initHawkingParticle(index, positions, velocities, colors, sizes, lifetimes, ages, lifeSpans, swirl, baseSizes) {
        const i3 = index * 3;

        const theta = this.random() * Math.PI * 2;
        const phi = Math.acos(2 * this.random() - 1);

        const radius = 110 + this.random() * 60;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        const x = radius * sinPhi * Math.cos(theta);
        const y = radius * sinPhi * Math.sin(theta);
        const z = radius * cosPhi * 0.4;

        positions[i3] = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;

        const dirX = x / Math.max(1, radius);
        const dirY = y / Math.max(1, radius);
        const dirZ = z / Math.max(1, radius);

        const speed = 0.4 + this.random() * 0.6;
        velocities[i3] = dirX * speed + (this.random() - 0.5) * 0.15;
        velocities[i3 + 1] = dirY * speed + (this.random() - 0.5) * 0.15;
        velocities[i3 + 2] = dirZ * speed + (this.random() - 0.5) * 0.12;

        const colorMix = this.random();
        const baseColor = colorMix > 0.5
            ? new THREE.Color(0x88ccff)
            : new THREE.Color(0xffbbdd);

        colors[i3] = baseColor.r;
        colors[i3 + 1] = baseColor.g;
        colors[i3 + 2] = baseColor.b;

        const baseSize = 3 + this.random() * 4;
        baseSizes[index] = baseSize;
        sizes[index] = baseSize;

        ages[index] = this.random() * 0.6;
        lifeSpans[index] = 0.8 + this.random() * 0.8;
        lifetimes[index] = Math.max(0, 1 - ages[index] / lifeSpans[index]);

        swirl[index] = (this.random() > 0.5 ? 1 : -1) * (0.4 + this.random() * 0.6);
    }

    createHawkingRadiation() {
        const count = this.getHawkingParticleCount();
        const positions = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lifetimes = new Float32Array(count);
        const ages = new Float32Array(count);
        const lifeSpans = new Float32Array(count);
        const swirl = new Float32Array(count);
        const baseSizes = new Float32Array(count);

        for (let i = 0; i < count; i += 1) {
            this.initHawkingParticle(
                i,
                positions,
                velocities,
                colors,
                sizes,
                lifetimes,
                ages,
                lifeSpans,
                swirl,
                baseSizes,
            );
        }

        if (this.hawkingParticles) {
            this.scene.remove(this.hawkingParticles);
            this.hawkingParticles = null;
        }

        if (this.isWebGPU) {
            const material = createHawkingRadiationNodeMaterial();
            const sprite = new THREE.Sprite(material);
            sprite.count = count;
            sprite.userData.baseCount = count;
            sprite.geometry = sprite.geometry.clone();
            sprite.geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3));
            sprite.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
            sprite.geometry.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(sizes, 1));
            sprite.geometry.setAttribute('instanceLifetime', new THREE.InstancedBufferAttribute(lifetimes, 1));
            sprite.frustumCulled = false;
            sprite.renderOrder = 60;
            this.hawkingParticles = sprite;
        } else {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
            geometry.setDrawRange(0, count);

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
                        gl_PointSize = size * (220.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform float uTime;
                    uniform float uIntensity;
                    varying vec3 vColor;
                    varying float vLifetime;

                    void main() {
                        vec2 center = gl_PointCoord - 0.5;
                        float dist = length(center);
                        if (dist > 0.5) discard;

                        float flicker = 0.7 + 0.3 * sin(uTime * 3.0 + vLifetime * 6.283);
                        float alpha = (1.0 - dist * 2.0) * vLifetime * flicker * uIntensity;
                        vec3 color = vColor * (1.0 + (1.0 - vLifetime) * 0.6) * uIntensity;

                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                vertexColors: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });

            this.hawkingParticles = new THREE.Points(geometry, material);
            this.hawkingParticles.userData.baseCount = count;
            this.hawkingParticles.frustumCulled = false;
            this.hawkingParticles.renderOrder = 60;
        }

        this.hawkingAttributes = {
            position: this.hawkingParticles.geometry.getAttribute(this.isWebGPU ? 'instancePosition' : 'position'),
            color: this.hawkingParticles.geometry.getAttribute(this.isWebGPU ? 'instanceColor' : 'color'),
            size: this.hawkingParticles.geometry.getAttribute(this.isWebGPU ? 'instanceSize' : 'size'),
            lifetime: this.hawkingParticles.geometry.getAttribute(this.isWebGPU ? 'instanceLifetime' : 'lifetime'),
        };
        this.hawkingVelocities = velocities;
        this.hawkingLifetimes = lifetimes;
        this.hawkingAges = ages;
        this.hawkingLifeSpans = lifeSpans;
        this.hawkingSwirl = swirl;
        this.hawkingBaseSizes = baseSizes;

        this.scene.add(this.hawkingParticles);
        console.log('[BlackHole] Hawking radiation created with', count, 'particles');
    }

    updateHawkingRadiation(delta) {
        if (!this.hawkingParticles || !this.hawkingAttributes) return;

        const positions = this.hawkingAttributes.position.array;
        const velocities = this.hawkingVelocities;
        const lifetimes = this.hawkingLifetimes;
        const ages = this.hawkingAges;
        const lifeSpans = this.hawkingLifeSpans;
        const swirl = this.hawkingSwirl;
        const sizes = this.hawkingAttributes.size.array;
        const baseSizes = this.hawkingBaseSizes;

        const count = lifetimes.length;
        for (let i = 0; i < count; i += 1) {
            const i3 = i * 3;

            positions[i3] += velocities[i3] * delta;
            positions[i3 + 1] += velocities[i3 + 1] * delta;
            positions[i3 + 2] += velocities[i3 + 2] * delta;

            const angle = swirl[i] * delta;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const px = positions[i3];
            const py = positions[i3 + 1];
            positions[i3] = px * cosA - py * sinA;
            positions[i3 + 1] = px * sinA + py * cosA;

            ages[i] += delta;
            const t = ages[i] / lifeSpans[i];
            const life = Math.max(0, 1 - t);
            lifetimes[i] = life;
            sizes[i] = baseSizes[i] * (0.6 + life * 0.6) * this.hawkingIntensity;

            if (t >= 1) {
                this.initHawkingParticle(
                    i,
                    positions,
                    velocities,
                    this.hawkingAttributes.color.array,
                    sizes,
                    lifetimes,
                    ages,
                    lifeSpans,
                    swirl,
                    baseSizes,
                );
            }
        }

        this.hawkingAttributes.position.needsUpdate = true;
        this.hawkingAttributes.size.needsUpdate = true;
        this.hawkingAttributes.lifetime.needsUpdate = true;
        this.hawkingAttributes.color.needsUpdate = true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dynamic Resolution + LOD
    // ─────────────────────────────────────────────────────────────────────────

    getDynamicPixelRatio() {
        const baseRatio = this.getEffectivePixelRatio();
        const scale = this.dynamicResolution?.enabled ? this.dynamicResolution.scale : 1.0;
        return Math.max(0.25, Math.round(baseRatio * scale * 100) / 100);
    }

    applyDynamicResolution(width = window.innerWidth, height = window.innerHeight) {
        if (!this.renderer) return;
        const ratio = this.getDynamicPixelRatio();
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(width, height);
        if (this.isWebGPU && this.postProcessing) {
            this.postProcessing.setSize(width, height);
        }
        if (!this.isWebGPU && this.composer) {
            this.composer.setSize(width, height);
        }
    }

    updateDynamicResolution(delta) {
        const drs = this.dynamicResolution;
        if (!drs?.enabled || !this.renderer) return;
        const frameMs = delta * 1000;
        drs.emaMs = drs.emaMs * 0.9 + frameMs * 0.1;
        drs.elapsed += delta;
        if (drs.elapsed < drs.adjustInterval) return;
        drs.elapsed = 0;

        let newScale = drs.scale;
        if (drs.emaMs > drs.targetMs * 1.12) {
            newScale = Math.max(drs.minScale, drs.scale - 0.05);
        } else if (drs.emaMs < drs.targetMs * 0.85) {
            newScale = Math.min(drs.maxScale, drs.scale + 0.05);
        }

        if (Math.abs(newScale - drs.scale) >= 0.01) {
            drs.scale = newScale;
            this.applyDynamicResolution();
            this.applyLod();
        }
    }

    applyLod() {
        const drs = this.dynamicResolution;
        if (!drs?.enabled) return;

        const scale = drs.scale;
        let starFactor = 1.0;
        let particleFactor = 1.0;
        let hawkingFactor = 1.0;

        if (scale < 0.75) {
            starFactor = 0.5;
            particleFactor = 0.6;
            hawkingFactor = 0.6;
        } else if (scale < 0.85) {
            starFactor = 0.75;
            particleFactor = 0.8;
            hawkingFactor = 0.8;
        }

        if (this.starfield) {
            const baseCount = this.starfield.userData.baseCount || this.qualityPreset.starCount;
            const targetCount = Math.max(200, Math.floor(baseCount * starFactor));
            if (this.isWebGPU) {
                if (this.starfield.count !== targetCount) {
                    this.starfield.count = targetCount;
                    this.lodState.starCount = targetCount;
                }
            } else if (this.starfield.geometry) {
                const current = this.starfield.geometry.drawRange?.count ?? baseCount;
                if (current !== targetCount) {
                    this.starfield.geometry.setDrawRange(0, targetCount);
                    this.lodState.starCount = targetCount;
                }
            }
        }

        if (this.particles) {
            const baseCount = this.particles.userData.baseCount || this.qualityPreset.particleCount;
            const targetCount = Math.max(600, Math.floor(baseCount * particleFactor));
            if (this.isWebGPU) {
                if (this.particles.count !== targetCount) {
                    this.particles.count = targetCount;
                    this.lodState.particleCount = targetCount;
                }
            } else if (this.particles.geometry) {
                const current = this.particles.geometry.drawRange?.count ?? baseCount;
                if (current !== targetCount) {
                    this.particles.geometry.setDrawRange(0, targetCount);
                    this.lodState.particleCount = targetCount;
                }
            }
        }

        if (this.hawkingParticles) {
            const baseCount = this.hawkingParticles.userData.baseCount || this.getHawkingParticleCount();
            const targetCount = Math.max(80, Math.floor(baseCount * hawkingFactor));
            if (this.isWebGPU) {
                if (this.hawkingParticles.count !== targetCount) {
                    this.hawkingParticles.count = targetCount;
                    this.lodState.hawkingCount = targetCount;
                }
            } else if (this.hawkingParticles.geometry) {
                const current = this.hawkingParticles.geometry.drawRange?.count ?? baseCount;
                if (current !== targetCount) {
                    this.hawkingParticles.geometry.setDrawRange(0, targetCount);
                    this.lodState.hawkingCount = targetCount;
                }
            }
        }
    }

    async updateGpuTimings() {
        if (!this.gpuTimings?.enabled || !this.renderer?.backend) return;
        const now = performance.now();
        if (now - this.gpuTimings.lastResolve < 1000) return;
        this.gpuTimings.lastResolve = now;

        try {
            await this.renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE);
        } catch (error) {
            return;
        }

        const backend = this.renderer.backend;
        const compute = {};
        const addTiming = (label, node) => {
            if (!node) return;
            const uid = backend.getTimestampUID(node);
            if (backend.hasTimestamp(uid)) {
                compute[label] = backend.getTimestamp(uid);
            }
        };

        addTiming('particles', this.particleCompute?.computeNode);
        addTiming('burst', this.burstCompute?.computeNode);
        addTiming('lensing', this.starLensingCompute?.computeNode);

        this.gpuTimings.compute = compute;

        if (this.flags.baseline && Object.keys(compute).length) {
            console.log('[BlackHole] GPU compute timings (ms):', compute);
        }
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

        if (this.isWebGPU && this.flags.useCompute) {
            try {
                if (this.burstCompute) {
                    this.burstCompute.dispose();
                    this.burstCompute = null;
                }
                if (this.burstSparks) {
                    this.scene.remove(this.burstSparks);
                    this.burstSparks = null;
                }
                if (this.burstSparksPool.length) {
                    this.burstSparksPool.forEach((burst) => {
                        if (burst?.geometry) burst.geometry.dispose();
                        if (burst?.material) burst.material.dispose();
                        this.scene.remove(burst);
                    });
                    this.burstSparksPool = [];
                }

                const angles = new Float32Array(count * 2);
                const colors = new Float32Array(count * 3);
                const sizes = new Float32Array(count);
                const randoms = new Float32Array(count);

                for (let i = 0; i < count; i++) {
                    const theta = this.random() * Math.PI * 2;
                    const phi = Math.acos(2 * this.random() - 1);

                    angles[i * 2] = theta;
                    angles[i * 2 + 1] = phi;
                    randoms[i] = this.random();

                    const colorType = this.random();
                    let c;
                    if (colorType > 0.5) c = colorOptions[0];
                    else if (colorType > 0.3) c = colorOptions[1];
                    else if (colorType > 0.15) c = colorOptions[2];
                    else if (colorType > 0.05) c = colorOptions[3];
                    else c = colorOptions[4];

                    const i3 = i * 3;
                    colors[i3] = c.r;
                    colors[i3 + 1] = c.g;
                    colors[i3 + 2] = c.b;

                    sizes[i] = 5 + this.random() * 8;
                }

                this.burstCompute = new BlackHoleBurstCompute(count);
                this.burstCompute.setInitialState(angles, colors, sizes, randoms);
                this.burstCompute.createComputeNode();

                const material = createBurstSparkNodeMaterial({
                    isWebGPU: this.isWebGPU,
                    burstCompute: this.burstCompute,
                });
                const burstSparks = new THREE.Sprite(material);
                burstSparks.count = count;
                burstSparks.geometry = burstSparks.geometry.clone();
                burstSparks.geometry.setAttribute(
                    'instancePosition',
                    new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
                );
                burstSparks.frustumCulled = false;
                this.burstSparks = burstSparks;
                this.burstSparksPool = [];
                this.scene.add(burstSparks);

                console.log('[BlackHole] Burst sparks compute system created with', count, 'particles');
                return;
            } catch (error) {
                console.warn('[BlackHole] Burst compute init failed, falling back to pool:', error);
                if (this.burstCompute) {
                    this.burstCompute.dispose();
                    this.burstCompute = null;
                }
                if (this.burstSparks) {
                    this.scene.remove(this.burstSparks);
                    this.burstSparks = null;
                }
            }
        }

        // Create pool of burst particle systems
        for (let poolIndex = 0; poolIndex < this.burstPoolSize; poolIndex++) {
            const thetas = new Float32Array(particlesPerBurst);
            const phis = new Float32Array(particlesPerBurst);
            const randoms = new Float32Array(particlesPerBurst);
            const colors = new Float32Array(particlesPerBurst * 3);
            const positions = new Float32Array(particlesPerBurst * 3);

            for (let i = 0; i < particlesPerBurst; i++) {
                // Distribute particles evenly on sphere surface (event horizon)
                const theta = this.random() * Math.PI * 2;
                const phi = Math.acos(2 * this.random() - 1);

                thetas[i] = theta;
                phis[i] = phi;
                randoms[i] = this.random();

                // Color selection - weighted toward hot colors
                const colorType = this.random();
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

            if (this.isWebGPU) {
                const material = createBurstSparkNodeMaterial({ isWebGPU: this.isWebGPU });
                const burstSparks = new THREE.Sprite(material);
                burstSparks.count = particlesPerBurst;
                burstSparks.geometry = burstSparks.geometry.clone();
                burstSparks.geometry.setAttribute('instanceTheta', new THREE.InstancedBufferAttribute(thetas, 1));
                burstSparks.geometry.setAttribute('instancePhi', new THREE.InstancedBufferAttribute(phis, 1));
                burstSparks.geometry.setAttribute('instanceRandom', new THREE.InstancedBufferAttribute(randoms, 1));
                burstSparks.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colors, 3));
                burstSparks.frustumCulled = false;
                this.burstSparksPool.push(burstSparks);
                this.scene.add(burstSparks);
            } else {
                const geometry = new THREE.BufferGeometry();
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
        }

        console.log('[BlackHole] Burst sparks pool created with', this.burstPoolSize, 'systems,', particlesPerBurst, 'particles each');
    }

    initParticle(index, positions, velocities, colors, sizes, lifetimes, colorPalette) {
        const i3 = index * 3;

        // Spawn in a ring around the black hole (tilted to match disk)
        const angle = this.random() * Math.PI * 2;
        const radius = 400 + this.random() * 600;
        const height = (this.random() - 0.5) * 120; // Thicker distribution for organic feel

        // Flat coordinates
        const px = Math.cos(angle) * radius;
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
        const orbitalSpeed = 0.3 + this.random() * 0.3;

        // Tangential velocity on flat plane
        const vx = -Math.sin(angle) * orbitalSpeed;
        let vy = (this.random() - 0.5) * 0.05;
        let vz = Math.cos(angle) * orbitalSpeed;

        // Rotate velocity to match tilted plane
        const v_y = vy * cosT - vz * sinT;
        const v_z = vy * sinT + vz * cosT;
        vy = v_y;
        vz = v_z;

        velocities[i3] = vx;
        velocities[i3 + 1] = vy;
        velocities[i3 + 2] = vz;

        const color = colorPalette[Math.floor(this.random() * colorPalette.length)];
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;

        sizes[index] = 6 + this.random() * 8;
        lifetimes[index] = 0.5 + this.random() * 0.5;
    }

    getMaterialUniform(material, name) {
        if (!material) return undefined;
        if (material.uniforms?.[name]) {
            return material.uniforms[name].value;
        }
        const node = material.userData?.[name];
        return node ? node.value : undefined;
    }

    setMaterialUniform(material, name, value) {
        if (!material) return;
        if (material.uniforms?.[name]) {
            material.uniforms[name].value = value;
            return;
        }
        const node = material.userData?.[name];
        if (node && 'value' in node) {
            node.value = value;
        }
    }

    setMaterialUniformVec2(material, name, x, y) {
        if (!material) return;
        if (material.uniforms?.[name]?.value?.set) {
            material.uniforms[name].value.set(x, y);
            return;
        }
        const node = material.userData?.[name];
        if (node?.value?.set) {
            node.value.set(x, y);
        }
    }

    setMaterialUniformVec3(material, name, x, y, z) {
        if (!material) return;
        if (material.uniforms?.[name]?.value?.set) {
            material.uniforms[name].value.set(x, y, z);
            return;
        }
        const node = material.userData?.[name];
        if (node?.value?.set) {
            node.value.set(x, y, z);
        }
    }

    resolveUniformRef(material, name) {
        if (!material) return null;
        if (material.uniforms?.[name]) {
            return material.uniforms[name];
        }
        const node = material.userData?.[name];
        return node || null;
    }

    cacheUniforms() {
        this.uniformCache = {
            coreTime: this.resolveUniformRef(this.blackHoleCore?.material, 'uTime'),
            coreIntensity: this.resolveUniformRef(this.blackHoleCore?.material, 'uIntensity'),
            diskTime: this.resolveUniformRef(this.accretionDisk?.material, 'uTime'),
            diskIntensity: this.resolveUniformRef(this.accretionDisk?.material, 'uIntensity'),
            diskRotation: this.resolveUniformRef(this.accretionDisk?.material, 'uRotationSpeed'),
            innerDiskTime: this.resolveUniformRef(this.innerDisk?.material, 'uTime'),
            innerDiskIntensity: this.resolveUniformRef(this.innerDisk?.material, 'uIntensity'),
            innerDiskRotation: this.resolveUniformRef(this.innerDisk?.material, 'uRotationSpeed'),
            starTime: this.resolveUniformRef(this.starfield?.material, 'uTime'),
            starFlash: this.resolveUniformRef(this.starfield?.material, 'uFlashIntensity'),
            hawkingTime: this.resolveUniformRef(this.hawkingParticles?.material, 'uTime'),
            hawkingIntensity: this.resolveUniformRef(this.hawkingParticles?.material, 'uIntensity'),
            photonTime: this.resolveUniformRef(this.photonSphere?.material, 'uTime'),
            photonIntensity: this.resolveUniformRef(this.photonSphere?.material, 'uIntensity'),
        };
    }

    setCachedUniform(key, value) {
        const ref = this.uniformCache?.[key];
        if (!ref) return;
        const current = ref.value;
        if (current?.set && value?.x !== undefined) {
            if (value?.z !== undefined) {
                current.set(value.x, value.y, value.z);
            } else {
                current.set(value.x, value.y);
            }
            return;
        }
        ref.value = value;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────

    setupPostProcessing() {
        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }

        if (this.isWebGPU) {
            if (!this.flags.usePost) return;

            this.postProcessing = new BlackHolePost(this.renderer, this.scene, this.camera, {
                useMRT: this.flags.useMRT,
                bloomStrength: this.qualityPreset.bloomStrength,
                bloomRadius: this.qualityPreset.bloomRadius,
                bloomThreshold: 0.15,
                bloomDownsample: 0.8,
                chromaticStrength: 0.002,
                vignetteOffset: 1.2,
                vignetteDarkness: 0.5,
                exposure: 1.05,
                contrast: 1.04,
                saturation: 1.08,
                tintStrength: 0.22,
                ditherStrength: 0.0025,
            });
            this.postProcessing.setSize(window.innerWidth, window.innerHeight);
            return;
        }

        if (!this.qualityPreset.enablePostProcessing || this.flags.noPost) return;

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

        // Color grading / tone mastering
        const colorGradePass = new ShaderPass(ColorGradeShader);
        colorGradePass.uniforms.exposure.value = 1.05;
        colorGradePass.uniforms.contrast.value = 1.04;
        colorGradePass.uniforms.saturation.value = 1.08;
        colorGradePass.uniforms.tint.value.set(1.04, 0.98, 1.08);
        colorGradePass.uniforms.tintStrength.value = 0.22;
        colorGradePass.uniforms.ditherStrength.value = 0.0025;
        this.composer.addPass(colorGradePass);

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
        // Layer subtle lock energy without resetting active combo momentum
        this.coreTargetIntensity = Math.min(2.4, this.coreTargetIntensity + 0.35);
        this.starFlashIntensity = Math.min(1.2, this.starFlashIntensity + 0.18);
        this.bloomPulseIntensity = Math.min(0.7, this.bloomPulseIntensity + 0.08);
        this.chromaticPulse = Math.min(0.012, this.chromaticPulse + 0.0015);
        this.hawkingTargetIntensity = Math.min(1.8, this.hawkingTargetIntensity + 0.08);
        this.photonSpherePulse = Math.min(1.2, this.photonSpherePulse + 0.08);
    }

    onLineClear(lineCount) {
        // Layer line-clear energy to avoid abrupt resets during combo chains
        this.diskTargetIntensity = Math.min(2.6, this.diskTargetIntensity + lineCount * 0.2);
        this.coreTargetIntensity = Math.min(3.2, this.coreTargetIntensity + lineCount * 0.35);
        this.diskTargetRotationSpeed = Math.min(4.0, this.diskTargetRotationSpeed + lineCount * 0.35);
        this.starFlashIntensity = Math.min(1.4, this.starFlashIntensity + lineCount * 0.22);
        this.bloomPulseIntensity = Math.min(1.0, this.bloomPulseIntensity + lineCount * 0.14);
        this.chromaticPulse = Math.min(0.02, this.chromaticPulse + lineCount * 0.0018);
        this.hawkingTargetIntensity = Math.min(2.0, this.hawkingTargetIntensity + lineCount * 0.16);
        this.photonSpherePulse = Math.min(1.4, this.photonSpherePulse + lineCount * 0.08);
    }

    onCombo(comboCount) {
        if (!this.isActive || comboCount < 2) return;

        const surgeGain = 2.0 + comboCount * 1.5;
        const burstGain = 3.0 + comboCount * 2.0;

        // Stack visual flare instead of replacing current combo momentum
        this.starFlashIntensity = Math.min(1.6, this.starFlashIntensity + 0.12 + comboCount * 0.08);
        this.bloomPulseIntensity = Math.min(1.0, this.bloomPulseIntensity + 0.08 + comboCount * 0.05);
        this.hawkingTargetIntensity = Math.min(2.2, this.hawkingTargetIntensity + 0.08 + comboCount * 0.06);
        this.photonSpherePulse = Math.min(1.5, this.photonSpherePulse + 0.12 + comboCount * 0.05);

        // Additive combo energy: every combo contributes immediately.
        this.gravitySurgeFactor = Math.min(36.0, this.gravitySurgeFactor + surgeGain);

        // Only use ambient-override jets if dedicated burst systems are unavailable.
        if (comboCount > 3 && !this.hasDedicatedComboBurstSystem()) {
            this.spawnJetParticles(comboCount);
            console.log('[BlackHole] Combo > 3, gravity surge:', this.gravitySurgeFactor);
        }

        // Always trigger burst immediately so rapid combos stack like other additive themes.
        this.triggerComboBurst(comboCount, surgeGain, burstGain);
    }

    hasDedicatedComboBurstSystem() {
        return Boolean(
            (this.isWebGPU && this.flags.useCompute && this.burstCompute?.computeNode)
            || this.burstSparksPool.length > 0,
        );
    }

    triggerComboBurst(comboCount, surgeGain, burstGain) {
        if (!this.isActive) return;

        // Keep combo forces additive: bursts add energy instead of subtracting suction.
        this.gravitySurgeFactor = Math.min(40.0, this.gravitySurgeFactor + surgeGain * 0.35);
        this.burstPhase = true;
        this.burstFactor = Math.min(40.0, this.burstFactor + burstGain);

        this.starFlashIntensity = Math.min(1.8, this.starFlashIntensity + 0.18 + comboCount * 0.12);
        this.bloomPulseIntensity = Math.min(1.2, this.bloomPulseIntensity + 0.14 + comboCount * 0.08);
        this.chromaticPulse = Math.min(0.03, this.chromaticPulse + 0.004 + comboCount * 0.0015);

        // Prefer dedicated burst systems (like Galaxy/Blood Moon behavior).
        if (this.isWebGPU && this.flags.useCompute && this.burstCompute?.computeNode) {
            const triggerCount = Math.min(1 + Math.floor(comboCount / 3), 4);
            for (let i = 0; i < triggerCount; i++) {
                const intensity = Math.min(1.0, comboCount / 8 + i * 0.1);
                this.burstCompute.trigger(this.random() * Math.PI * 2, intensity);
            }
        } else if (this.burstSparksPool.length > 0) {
            const systemsToTrigger = Math.min(1 + Math.floor(comboCount / 3), this.burstSparksPool.length, 4);
            for (let i = 0; i < systemsToTrigger; i++) {
                const index = (this.nextBurstIndex + i) % this.burstSparksPool.length;
                const burstSparks = this.burstSparksPool[index];
                this.setMaterialUniform(burstSparks?.material, 'uPulseTimer', 0.0);
            }
            this.nextBurstIndex = (this.nextBurstIndex + systemsToTrigger) % this.burstSparksPool.length;
            console.log('[BlackHole] Triggered burst systems:', systemsToTrigger);
        } else {
            // Fallback for environments where dedicated burst systems are unavailable.
            this.spawnBurstParticles(comboCount);
        }

        console.log('[BlackHole] Burst triggered! Factor:', this.burstFactor);
    }

    getBurstSpawnCount(comboCount, totalParticles) {
        if (totalParticles <= 0) return 0;

        const multiplier = this.flags.useUnifiedParticles ? 90 : 60;
        const maxByQuality = this.flags.useUnifiedParticles
            ? Math.max(320, Math.floor(this.qualityPreset.particleCount * 0.18))
            : Math.max(240, Math.floor(this.qualityPreset.particleCount * 0.14));
        const burstMax = Math.min(totalParticles, maxByQuality);

        return Math.min(comboCount * multiplier, burstMax);
    }

    getJetSpawnCount(comboCount, totalParticles) {
        if (totalParticles <= 0) return 0;

        const multiplier = this.flags.useUnifiedParticles ? 36 : 26;
        const maxByQuality = this.flags.useUnifiedParticles
            ? Math.max(200, Math.floor(this.qualityPreset.particleCount * 0.07))
            : Math.max(140, Math.floor(this.qualityPreset.particleCount * 0.05));
        const jetMax = Math.min(totalParticles, maxByQuality);

        return Math.min(comboCount * multiplier, jetMax);
    }

    allocateComboParticleIndices(requestedCount, cursorKey, cooldownSeconds) {
        const tableCount = this.comboSpawnReuseUntil ? this.comboSpawnReuseUntil.length : 0;
        const attrCount = this.particleAttributes?.position?.array
            ? Math.floor(this.particleAttributes.position.array.length / 3)
            : 0;
        const total = this.particleCompute?.count || tableCount || attrCount;
        if (requestedCount <= 0 || total <= 0) return [];

        let cursor = (this[cursorKey] || 0) % total;
        const lockTable = this.comboSpawnReuseUntil;

        // Fallback ring behavior if lock table is unavailable/mismatched.
        if (!lockTable || lockTable.length !== total) {
            const indices = [];
            for (let i = 0; i < requestedCount; i++) {
                indices.push(cursor);
                cursor = (cursor + 1) % total;
            }
            this[cursorKey] = cursor;
            return indices;
        }

        const now = this.time;
        const indices = [];

        for (let i = 0; i < requestedCount; i++) {
            let selected = -1;
            let scanned = 0;

            while (scanned < total) {
                const candidate = (cursor + scanned) % total;
                if (lockTable[candidate] <= now) {
                    selected = candidate;
                    cursor = (candidate + 1) % total;
                    break;
                }
                scanned += 1;
            }

            if (selected === -1) {
                // No free slots right now: keep additive visuals stable rather than overwriting fresh particles.
                break;
            }

            lockTable[selected] = now + cooldownSeconds;
            indices.push(selected);
        }

        this[cursorKey] = cursor;
        return indices;
    }

    /**
     * Spawn particles from center during burst for explosive effect
     */
    spawnBurstParticles(comboCount) {
        if (!this.particles) return;

        if (this.isWebGPU && this.flags.useCompute && this.particleCompute?.computeNode) {
            const bhX = this.driftX || 0;
            const bhY = this.driftY || 0;
            const bhZ = 0;
            const total = this.particleCompute.count;
            if (total <= 0) return;
            const burstCount = this.getBurstSpawnCount(comboCount, total);
            const indices = this.allocateComboParticleIndices(burstCount, 'nextBurstParticleIndex', 0.45);
            if (!indices.length) return;

            for (let i = 0; i < indices.length; i++) {
                const index = indices[i];
                const theta = this.random() * Math.PI * 2;
                const phi = Math.acos(2 * this.random() - 1);
                const speed = 8 + this.random() * 12 + comboCount * 2;

                const x = bhX + (this.random() - 0.5) * 30;
                const y = bhY + (this.random() - 0.5) * 30;
                const z = bhZ + (this.random() - 0.5) * 30;

                const vx = Math.sin(phi) * Math.cos(theta) * speed;
                const vy = Math.sin(phi) * Math.sin(theta) * speed;
                const vz = Math.cos(phi) * speed;

                const colorChoice = this.random();
                let color;
                if (colorChoice < 0.3) {
                    color = new THREE.Color(1.0, 1.0, 0.9);
                } else if (colorChoice < 0.6) {
                    color = new THREE.Color(1.0, 0.7, 0.2);
                } else {
                    color = new THREE.Color(0.4, 0.8, 1.0);
                }

                const lockUntil = this.comboSpawnReuseUntil?.[index] || (this.time + 0.45);
                this.particleCompute.spawn(index, {
                    x,
                    y,
                    z,
                    vx,
                    vy,
                    vz,
                    size: 6 + this.random() * 8,
                    life: 1.0,
                    color,
                }, lockUntil);
            }
            return;
        }

        if (!this.particleAttributes) return;

        const positions = this.particleAttributes.position.array;
        const velocities = this.particleVelocities;
        const colors = this.particleAttributes.color.array;
        const sizes = this.particleAttributes.size.array;
        const lifetimes = this.particleLifetimes;

        const bhX = this.driftX || 0;
        const bhY = this.driftY || 0;
        const bhZ = 0;

        const total = positions.length / 3;
        if (total <= 0) return;
        const burstCount = this.getBurstSpawnCount(comboCount, total);
        const indices = this.allocateComboParticleIndices(burstCount, 'nextBurstParticleIndex', 0.45);
        if (!indices.length) return;

        for (let i = 0; i < indices.length; i++) {
            const index = indices[i];
            const i3 = index * 3;

            // Spawn at black hole center with small random offset
            positions[i3] = bhX + (this.random() - 0.5) * 30;
            positions[i3 + 1] = bhY + (this.random() - 0.5) * 30;
            positions[i3 + 2] = bhZ + (this.random() - 0.5) * 30;

            // Explosive outward velocity in random direction
            const theta = this.random() * Math.PI * 2;
            const phi = Math.acos(2 * this.random() - 1);
            const speed = 8 + this.random() * 12 + comboCount * 2;

            velocities[i3] = Math.sin(phi) * Math.cos(theta) * speed;
            velocities[i3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
            velocities[i3 + 2] = Math.cos(phi) * speed;

            // Bright hot colors for burst particles
            const colorChoice = this.random();
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
            sizes[index] = 6 + this.random() * 8;
            lifetimes[index] = 1.0;
        }

        this.particleAttributes.position.needsUpdate = true;
        this.particleAttributes.color.needsUpdate = true;
        this.particleAttributes.size.needsUpdate = true;
    }

    spawnJetParticles(comboCount) {
        // Add jet particles shooting from poles
        if (!this.particles) return;
        const bhX = this.driftX || 0;
        const bhY = this.driftY || 0;
        const bhZ = 0;

        if (this.isWebGPU && this.flags.useCompute && this.particleCompute?.computeNode) {
            const total = this.particleCompute.count;
            if (total <= 0) return;
            const jetCount = this.getJetSpawnCount(comboCount, total);
            const indices = this.allocateComboParticleIndices(jetCount, 'nextJetParticleIndex', 0.32);
            if (!indices.length) return;

            for (let i = 0; i < indices.length; i++) {
                const index = indices[i];
                const direction = this.random() > 0.5 ? 1 : -1;
                const speed = 5 + this.random() * 10;

                // Spawn around the live black hole position so jets originate from the hole.
                const x = bhX + (this.random() - 0.5) * 20;
                const y = bhY + (this.random() - 0.5) * 20;
                const z = bhZ + (this.random() - 0.5) * 20;

                const vx = (this.random() - 0.5) * 2;
                const vy = direction * speed;
                const vz = (this.random() - 0.5) * 2;

                const color = direction > 0
                    ? new THREE.Color(0.4, 0.6, 1.0)
                    : new THREE.Color(1.0, 0.3, 0.2);

                const lockUntil = this.comboSpawnReuseUntil?.[index] || (this.time + 0.32);
                this.particleCompute.spawn(index, {
                    x,
                    y,
                    z,
                    vx,
                    vy,
                    vz,
                    size: 4 + this.random() * 4,
                    life: 1.0,
                    color,
                }, lockUntil);
            }
            return;
        }

        if (!this.particleAttributes) return;

        const positions = this.particleAttributes.position.array;
        const velocities = this.particleVelocities;
        const colors = this.particleAttributes.color.array;
        const sizes = this.particleAttributes.size.array;
        const lifetimes = this.particleLifetimes;

        const total = positions.length / 3;
        if (total <= 0) return;
        const jetCount = this.getJetSpawnCount(comboCount, total);
        const indices = this.allocateComboParticleIndices(jetCount, 'nextJetParticleIndex', 0.32);
        if (!indices.length) return;

        for (let i = 0; i < indices.length; i++) {
            const index = indices[i];
            const i3 = index * 3;

            // Spawn around the live black hole position
            positions[i3] = bhX + (this.random() - 0.5) * 20;
            positions[i3 + 1] = bhY + (this.random() - 0.5) * 20;
            positions[i3 + 2] = bhZ + (this.random() - 0.5) * 20;

            // Jet velocity (up or down)
            const direction = this.random() > 0.5 ? 1 : -1;
            const speed = 5 + this.random() * 10;
            velocities[i3] = (this.random() - 0.5) * 2;
            velocities[i3 + 1] = direction * speed;
            velocities[i3 + 2] = (this.random() - 0.5) * 2;

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

            sizes[index] = 4 + this.random() * 4;
            lifetimes[index] = 1.0;
        }

        this.particleAttributes.position.needsUpdate = true;
        this.particleAttributes.color.needsUpdate = true;
        this.particleAttributes.size.needsUpdate = true;
    }

    updateNaturalCamera(delta) {
        if (!this.camera) return;

        const t = this.time;
        const comboEnergy = Math.min(
            1.0,
            this.starFlashIntensity * 0.65
                + this.bloomPulseIntensity * 0.45
                + this.gravitySurgeFactor * 0.03
                + this.burstFactor * 0.03,
        );

        const swayScale = 0.7 + comboEnergy * 0.6;
        const swayX = (
            Math.sin(t * 0.22 + this.cameraPhaseX) * 16
            + Math.cos(t * 0.09 + this.cameraPhaseY) * 10
        ) * swayScale;
        const swayY = (
            Math.cos(t * 0.18 + this.cameraPhaseY) * 11
            + Math.sin(t * 0.11 + this.cameraPhaseZ) * 7
        ) * swayScale;
        const breatheZ = Math.sin(t * 0.14 + this.cameraPhaseZ) * (14 + comboEnergy * 10);

        const followX = this.driftX * 0.08;
        const followY = this.driftY * 0.06;
        const surgePushIn = comboEnergy * 24;

        this.cameraTargetPosition.set(
            this.cameraBasePosition.x + followX + swayX,
            this.cameraBasePosition.y + followY + swayY,
            this.cameraBasePosition.z + breatheZ - surgePushIn,
        );

        const moveLerp = Math.min(1.0, delta * (1.8 + comboEnergy * 0.9));
        this.camera.position.lerp(this.cameraTargetPosition, moveLerp);

        const lookX = this.driftX + Math.sin(t * 0.2 + this.cameraPhaseX) * (5 + comboEnergy * 4);
        const lookY = this.driftY + Math.cos(t * 0.17 + this.cameraPhaseY) * (3 + comboEnergy * 3);

        this.cameraLookTarget.set(lookX, lookY, 0);
        const lookLerp = Math.min(1.0, delta * (2.4 + comboEnergy * 1.2));
        this.cameraLookTargetSmoothed.lerp(this.cameraLookTarget, lookLerp);
        this.camera.lookAt(this.cameraLookTargetSmoothed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.fixedDeltaSeconds ?? this.clock.getDelta();
            this.time += delta;
            this.updateDynamicResolution(delta);
            void this.updateGpuTimings();

            // Smooth intensity transitions
            this.diskIntensity += (this.diskTargetIntensity - this.diskIntensity) * 0.1;
            this.coreIntensity += (this.coreTargetIntensity - this.coreIntensity) * 0.15;
            this.diskRotationSpeed += (this.diskTargetRotationSpeed - this.diskRotationSpeed) * 0.05;
            this.hawkingIntensity += (this.hawkingTargetIntensity - this.hawkingIntensity) * 0.08;

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
            if (this.photonSpherePulse > 0) {
                this.photonSpherePulse *= 0.9;
                if (this.photonSpherePulse < 0.01) this.photonSpherePulse = 0;
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
            if (this.diskTargetIntensity > 1.0) {
                this.diskTargetIntensity += (1.0 - this.diskTargetIntensity) * 0.02;
                if (this.diskTargetIntensity < 1.01) this.diskTargetIntensity = 1.0;
            }
            if (this.coreTargetIntensity > 1.0) {
                this.coreTargetIntensity += (1.0 - this.coreTargetIntensity) * 0.03;
                if (this.coreTargetIntensity < 1.01) this.coreTargetIntensity = 1.0;
            }
            if (this.diskTargetRotationSpeed > 1.0) {
                this.diskTargetRotationSpeed += (1.0 - this.diskTargetRotationSpeed) * 0.025;
                if (this.diskTargetRotationSpeed < 1.01) this.diskTargetRotationSpeed = 1.0;
            }
            if (this.hawkingTargetIntensity > 1.0) {
                this.hawkingTargetIntensity += (1.0 - this.hawkingTargetIntensity) * 0.02;
                if (this.hawkingTargetIntensity < 1.01) this.hawkingTargetIntensity = 1.0;
            }

            // Update shaders
            this.setCachedUniform('coreTime', this.time);
            this.setCachedUniform('coreIntensity', this.coreIntensity);

            this.setCachedUniform('diskTime', this.time);
            this.setCachedUniform('diskIntensity', this.diskIntensity);
            this.setCachedUniform('diskRotation', this.diskRotationSpeed);

            this.setCachedUniform('innerDiskTime', this.time * 1.3);
            this.setCachedUniform('innerDiskIntensity', this.diskIntensity * 1.2);
            this.setCachedUniform('innerDiskRotation', this.diskRotationSpeed * 1.5);

            this.accretionVolumeLayers.forEach((layer, index) => {
                const boost = 0.2 + index * 0.1;
                this.setMaterialUniform(layer?.material, 'uTime', this.time * 0.8);
                this.setMaterialUniform(layer?.material, 'uIntensity', this.diskIntensity * boost);
                this.setMaterialUniform(layer?.material, 'uRotationSpeed', this.diskRotationSpeed * 0.6);
            });

            this.setCachedUniform('starTime', this.time);
            this.setCachedUniform('starFlash', this.starFlashIntensity);
            this.setCachedUniform('hawkingTime', this.time);
            this.setCachedUniform('hawkingIntensity', this.hawkingIntensity);
            this.setCachedUniform('photonTime', this.time);
            this.setCachedUniform('photonIntensity', 0.9 + this.coreIntensity * 0.2 + this.photonSpherePulse);

            // Update burst sparks (pool path only)
            if (!this.burstCompute?.computeNode) {
                this.burstSparksPool.forEach((burstSparks) => {
                    const material = burstSparks?.material;
                    if (!material) return;

                    this.setMaterialUniform(material, 'uTime', this.time);

                    // Advance pulse wave when active
                    const pulseTimer = this.getMaterialUniform(material, 'uPulseTimer');
                    if (pulseTimer !== undefined && pulseTimer > -50.0) {
                        // Move wave outwards - speed controls explosion rate
                        const nextPulse = pulseTimer + delta * 18.0;

                        // Turn off when wave completes (maxLife 45 + stagger 3 + buffer)
                        this.setMaterialUniform(material, 'uPulseTimer', nextPulse > 60.0 ? -100.0 : nextPulse);
                    }
                });
            }

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
            if (this.accretionVolumeLayers.length) {
                this.accretionVolumeLayers.forEach((layer) => {
                    layer.position.x = this.driftX;
                    layer.position.y = this.driftY;
                    this.setMaterialUniformVec3(layer?.material, 'uCenter', this.driftX, this.driftY, 0);
                });
            }
            if (this.hawkingParticles) {
                this.hawkingParticles.position.x = this.driftX;
                this.hawkingParticles.position.y = this.driftY;
            }
            if (this.photonSphere) {
                this.photonSphere.position.x = this.driftX;
                this.photonSphere.position.y = this.driftY;
            }

            this.setMaterialUniformVec2(this.starfield?.material, 'uBlackHolePos', this.driftX, this.driftY);

            if (this.starLensingCompute?.computeNode && this.renderer?.compute) {
                const strengthBoost = Math.min(
                    0.45,
                    this.starFlashIntensity * 0.25
                        + this.gravitySurgeFactor * 0.03
                        + this.burstFactor * 0.02,
                );
                const lensingStrength = 0.55 + strengthBoost;
                this.starLensingCompute.update({
                    time: this.time,
                    blackHolePos: this.computeBlackHolePos.set(this.driftX || 0, this.driftY || 0, 0),
                    strength: lensingStrength,
                    activeCount: this.starfield?.count ?? this.starLensingCompute.count,
                });
                this.renderer.compute(this.starLensingCompute.computeNode);
            }

            // Update burst sparks compute after drift update
            if (this.burstCompute?.computeNode) {
                this.burstCompute.update(delta, {
                    time: this.time,
                    blackHolePos: this.computeBlackHolePos.set(this.driftX || 0, this.driftY || 0, 0),
                    burstFactor: this.burstFactor,
                });
                if (this.renderer?.compute) {
                    this.renderer.compute(this.burstCompute.computeNode);
                }
            }

            // Update burst sparks position to follow black hole (pool path only)
            if (!this.burstCompute?.computeNode) {
                this.burstSparksPool.forEach((burstSparks) => {
                    this.setMaterialUniformVec2(burstSparks?.material, 'uBlackHolePos', this.driftX, this.driftY);
                });
            }

            // Update particles
            this.updateParticles(delta);
            this.updateHawkingRadiation(delta);

            // Subtle nebula rotation
            this.nebulaClouds.forEach((cloud) => {
                cloud.rotation.z += 0.0001;
            });

            this.updateNaturalCamera(delta);

            // Post-processing updates
            if (this.bloomPass) {
                this.bloomPass.strength = this.qualityPreset.bloomStrength * (1 + this.bloomPulseIntensity);
            }
            if (this.chromaticPass) {
                this.chromaticPass.uniforms.amount.value = Math.max(0.002, this.chromaticPulse);
            }
            if (this.postProcessing) {
                this.postProcessing.update({
                    bloomStrength: this.qualityPreset.bloomStrength * (1 + this.bloomPulseIntensity),
                    bloomRadius: this.qualityPreset.bloomRadius,
                    chromaticStrength: Math.max(0.002, this.chromaticPulse),
                });
            }

            // Render
            if (this.isWebGPU) {
                this.renderer.clear();
                if (this.postProcessing && this.flags.usePost) {
                    this.postProcessing.render();
                } else {
                    this.renderer.render(this.scene, this.camera);
                }
            } else if (this.composer && this.qualityPreset.enablePostProcessing) {
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

        if (this.isWebGPU && this.flags.useCompute && this.particleCompute?.computeNode && this.renderer?.compute) {
            const bhX = this.driftX || 0;
            const bhY = this.driftY || 0;
            const bhZ = 0;

            this.computeBlackHolePos.set(bhX, bhY, bhZ);
            this.particleCompute.update(delta, {
                time: this.time,
                blackHolePos: this.computeBlackHolePos,
                gravitySurge: this.gravitySurgeFactor,
                burstFactor: this.burstFactor,
                burstPhase: this.burstPhase,
                activeCount: this.particles?.count ?? this.particleCompute.count,
            });
            this.renderer.compute(this.particleCompute.computeNode);
            return;
        }

        if (!this.particleAttributes) return;

        const positions = this.particleAttributes.position.array;
        const velocities = this.particleVelocities;
        const lifetimes = this.particleLifetimes;

        const bhX = this.driftX || 0;
        const bhY = this.driftY || 0;
        const bhZ = 0;
        const burstBlend = Math.min(1.0, this.burstFactor / 8.0);

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
                    velocities[i3] * velocities[i3]
                    + velocities[i3 + 1] * velocities[i3 + 1]
                    + velocities[i3 + 2] * velocities[i3 + 2],
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

            // Smoothly relax reset distance during bursts so chained combos don't pop particles back.
            const maxDist = 1500 + burstBlend * 1000;
            const ndx = bhX - positions[i3];
            const ndy = bhY - positions[i3 + 1];
            const ndz = bhZ - positions[i3 + 2];
            const nextDist = Math.sqrt(ndx * ndx + ndy * ndy + ndz * ndz);
            const isComboLocked = this.comboSpawnReuseUntil?.[i] > this.time;
            if (!isComboLocked && (nextDist < 80 || nextDist > maxDist)) {
                this.initParticle(
                    i,
                    positions,
                    velocities,
                    this.particleAttributes.color.array,
                    this.particleAttributes.size.array,
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

        this.particleAttributes.position.needsUpdate = true;
        this.particleAttributes.lifetime.needsUpdate = true;
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
            this.applyDynamicResolution(width, height);
        }
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

        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }
        if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }
        if (this.burstCompute) {
            this.burstCompute.dispose();
            this.burstCompute = null;
        }
        if (this.starLensingCompute) {
            this.starLensingCompute.dispose();
            this.starLensingCompute = null;
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.particleAttributes = null;
        this.comboSpawnReuseUntil = null;
        this.isWebGPU = false;
        this.blackHoleCore = null;
        this.accretionDisk = null;
        this.accretionVolumeLayers = [];
        this.starfield = null;
        this.particles = null;
        this.hawkingParticles = null;
        this.photonSphere = null;
        this.burstSparks = null;
        this.burstSparksPool = [];
        this.nextBurstIndex = 0;
        this.nebulaClouds = [];
        this.hawkingAttributes = null;
        this.hawkingVelocities = null;
        this.hawkingLifetimes = null;
        this.hawkingAges = null;
        this.hawkingLifeSpans = null;
        this.hawkingSwirl = null;
        this.hawkingBaseSizes = null;
        if (this.nebulaTexture) {
            this.nebulaTexture.dispose();
            this.nebulaTexture = null;
        }

        super.cleanup();
    }
}
