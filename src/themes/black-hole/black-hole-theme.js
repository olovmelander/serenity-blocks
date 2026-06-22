/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ BLACK HOLE ✧
 *  A 3D Space Theme for Serenity Blocks using Three.js
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Raymarched black hole with gravitational lensing
 * - Volumetric accretion disk with Doppler effects
 * - 3D starfield with cinematic static glow
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
        starCount: 2200,
        particleCount: 5600,
        comboParticleBudget: 9200,
        nebulaCount: 16,
        diskSegments: 80,
        burstSparkCount: 11000,
        maxPixelRatio: 1.5,
        bloomStrength: 0.6,
        bloomRadius: 0.8,
        bloomDownsample: 0.7,
        bloomMinDownsample: 0.54,
        enablePostProcessing: true,
        enableVolumetricDisk: true,
        enableChromatic: true,
        materialNoiseOctaves: 3,
        burstCapacityMultiplier: 2.4,
        burstLifetimeSeconds: 16,
        comboScatterBaseSeconds: 12,
        comboScatterComboSeconds: 0.35,
        comboScatterMaxBonusSeconds: 4,
        burstDecay: 0.96,
        burstMinBatchFactor: 0.01,
        burstMaxBatchFactor: 0.075,
        particleComputeInterval: 0,
        hawkingUpdateInterval: 1 / 45,
        layeredDiskCount: 3,
        sortObjects: true,
    },
    Ultra: {
        starCount: 1700,
        particleCount: 4200,
        comboParticleBudget: 7200,
        nebulaCount: 12,
        diskSegments: 60,
        burstSparkCount: 7500,
        maxPixelRatio: 1.25,
        bloomStrength: 0.55,
        bloomRadius: 0.7,
        bloomDownsample: 0.64,
        bloomMinDownsample: 0.5,
        enablePostProcessing: true,
        enableVolumetricDisk: true,
        enableChromatic: true,
        materialNoiseOctaves: 2,
        burstCapacityMultiplier: 1.8,
        burstLifetimeSeconds: 14,
        comboScatterBaseSeconds: 10,
        comboScatterComboSeconds: 0.3,
        comboScatterMaxBonusSeconds: 3.5,
        burstDecay: 0.945,
        burstMinBatchFactor: 0.009,
        burstMaxBatchFactor: 0.06,
        particleComputeInterval: 1 / 90,
        hawkingUpdateInterval: 1 / 36,
        layeredDiskCount: 3,
        sortObjects: true,
    },
    High: {
        starCount: 820,
        particleCount: 1600,
        comboParticleBudget: 3000,
        nebulaCount: 5,
        diskSegments: 32,
        burstSparkCount: 2200,
        maxPixelRatio: 1.0,
        bloomStrength: 0.34,
        bloomRadius: 0.42,
        bloomDownsample: 0.44,
        bloomMinDownsample: 0.34,
        enablePostProcessing: true,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 2,
        burstCapacityMultiplier: 1,
        burstLifetimeSeconds: 8,
        comboScatterBaseSeconds: 5.5,
        comboScatterComboSeconds: 0.18,
        comboScatterMaxBonusSeconds: 1.8,
        burstDecay: 0.91,
        burstMinBatchFactor: 0.004,
        burstMaxBatchFactor: 0.045,
        particleComputeInterval: 1 / 30,
        hawkingUpdateInterval: 1 / 24,
        layeredDiskCount: 1,
        sortObjects: false,
    },
    Medium: {
        starCount: 750,
        particleCount: 1600,
        comboParticleBudget: 2800,
        nebulaCount: 5,
        diskSegments: 32,
        burstSparkCount: 2400,
        maxPixelRatio: 1.0,
        bloomStrength: 0.34,
        bloomRadius: 0.42,
        bloomDownsample: 0.52,
        bloomMinDownsample: 0.38,
        enablePostProcessing: true,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 2,
        burstCapacityMultiplier: 1.1,
        burstLifetimeSeconds: 9,
        comboScatterBaseSeconds: 6.5,
        comboScatterComboSeconds: 0.22,
        comboScatterMaxBonusSeconds: 2.2,
        burstDecay: 0.92,
        burstMinBatchFactor: 0.005,
        burstMaxBatchFactor: 0.035,
        particleComputeInterval: 1 / 36,
        hawkingUpdateInterval: 1 / 24,
        layeredDiskCount: 2,
        sortObjects: false,
    },
    Low: {
        starCount: 420,
        particleCount: 900,
        comboParticleBudget: 1500,
        nebulaCount: 3,
        diskSegments: 24,
        burstSparkCount: 1400,
        maxPixelRatio: 0.9,
        bloomStrength: 0.3,
        bloomRadius: 0.4,
        bloomDownsample: 0.5,
        bloomMinDownsample: 0.36,
        enablePostProcessing: false,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 1,
        burstCapacityMultiplier: 1,
        burstLifetimeSeconds: 8,
        comboScatterBaseSeconds: 5,
        comboScatterComboSeconds: 0.16,
        comboScatterMaxBonusSeconds: 1.6,
        burstDecay: 0.9,
        burstMinBatchFactor: 0.004,
        burstMaxBatchFactor: 0.03,
        particleComputeInterval: 1 / 30,
        hawkingUpdateInterval: 1 / 20,
        layeredDiskCount: 1,
        sortObjects: false,
    },
    Minimal: {
        starCount: 220,
        particleCount: 520,
        comboParticleBudget: 1400,
        nebulaCount: 2,
        diskSegments: 18,
        burstSparkCount: 800,
        maxPixelRatio: 0.85,
        bloomStrength: 0.2,
        bloomRadius: 0.3,
        bloomDownsample: 0.48,
        bloomMinDownsample: 0.34,
        enablePostProcessing: false,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 1,
        burstCapacityMultiplier: 1,
        burstLifetimeSeconds: 7,
        comboScatterBaseSeconds: 4.5,
        comboScatterComboSeconds: 0.14,
        comboScatterMaxBonusSeconds: 1.4,
        burstDecay: 0.9,
        burstMinBatchFactor: 0.003,
        burstMaxBatchFactor: 0.025,
        particleComputeInterval: 1 / 24,
        hawkingUpdateInterval: 1 / 18,
        layeredDiskCount: 1,
        sortObjects: false,
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
    uniform vec3 uBlackHolePos;

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

        // Explosion phase (life 0→0.4) + Float phase (life 0.4→1.0)
        float maxLife = 120.0;
        float life = clamp(localTime / maxLife, 0.0, 1.0);

        float explosionProgress = clamp(life / 0.4, 0.0, 1.0);
        float floatProgress = clamp((life - 0.4) / 0.6, 0.0, 1.0);

        float startRadius = 120.0;
        float maxRadius = 900.0 + aRandom * 700.0;

        // Fast ease-out for explosion
        float easeOut = 1.0 - pow(1.0 - explosionProgress, 2.5);
        float explosionRadius = startRadius + (maxRadius - startRadius) * easeOut;

        // Gentle oscillating drift during float phase (in disk-local XZ plane)
        float driftAmt = maxRadius * 0.12;
        float driftDiskX = cos(aRandom * 6.2832 + life * 2.5) * driftAmt * floatProgress;
        float driftDiskZ = sin(aRandom * 9.4248 + life * 1.8) * driftAmt * floatProgress;

        float spiralAngle = aTheta + life * 1.5 * (aRandom - 0.5);
        // Burst expands in the accretion disk plane (disk lies in XZ before rotation)
        float diskX = explosionRadius * cos(spiralAngle) + driftDiskX;
        float diskZ = explosionRadius * sin(spiralAngle) + driftDiskZ;
        float diskH = explosionRadius * (aPhi - 1.5708) * 0.04;

        // Rotate by disk tilt (rotation.x = -PI * 0.42) to match the accretion disk
        const float cosT = 0.2486898871648548;
        const float sinT = -0.9685831611286311;
        float x = diskX;
        float y = diskH * cosT - diskZ * sinT;
        float z = diskH * sinT + diskZ * cosT;

        // Offset by black hole position
        vec3 pos = vec3(x + uBlackHolePos.x, y + uBlackHolePos.y, z + uBlackHolePos.z);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // Size - larger at start, shrinking as they fly out
        float baseSize = 5.0 + aRandom * 8.0;
        float sizeLife = 1.0 - life * 0.6;
        gl_PointSize = baseSize * sizeLife * (300.0 / -mvPosition.z);

        // Hold bright through float, only fade in last 20%
        float fadeCurve = 1.0 - smoothstep(0.8, 1.0, life);
        vAlpha = fadeCurve * (0.9 + aRandom * 0.1);
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
            for (int i = 0; i < 3; i++) {
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
            for (int i = 0; i < 3; i++) {
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
        uniform vec3 uDiskNormal;
        varying vec3 vWorldPos;

        #define PI 3.14159265359

        // Noise functions for the plasma
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
            for (int i = 0; i < 3; i++) {
                v += a * noise(p);
                p *= 2.0;
                a *= 0.5;
            }
            return v;
        }

        void main() {
            vec3 ro = cameraPosition;
            vec3 rd = normalize(vWorldPos - cameraPosition);

            const int STEPS = 20;
            float stepSize = 32.0;

            vec3 accumColor = vec3(0.0);
            float activeRay = 1.0;
            
            float eventHorizon = 110.0;
            float gravStrength = 2600.0;

            for (int i = 0; i < STEPS; i++) {
                vec3 toCenter = uCenter - ro;
                float distSq = dot(toCenter, toCenter);
                float dist = sqrt(distSq);

                // Event horizon kill switch (light absorbed)
                if (dist < eventHorizon) {
                    activeRay = 0.0;
                    break;
                }

                // Gravity bends the ray path towards the black hole
                float forceDist = max(distSq, eventHorizon * eventHorizon);
                vec3 gravityForce = (toCenter / dist) * (gravStrength / forceDist);
                rd = normalize(rd + gravityForce * stepSize);

                ro += rd * stepSize;

                // Sample accretion disk volume at current warped position (ro)
                float height = dot(ro - uCenter, uDiskNormal);
                vec3 radialVec = (ro - uCenter) - uDiskNormal * height;
                float radialDist = length(radialVec);

                // Disk bounds
                if (radialDist > 130.0 && radialDist < 450.0 && abs(height) < 40.0) {
                    float radialMask = smoothstep(130.0, 160.0, radialDist) * (1.0 - smoothstep(380.0, 450.0, radialDist));
                    float heightFalloff = exp(-height * height * 0.003);
                    
                    float angle = atan(radialVec.z, radialVec.x); // Using x/z of radial vec relative to normal
                    float rotatedAngle = angle + uTime * uRotationSpeed * 0.12;
                    float normalizedRadius = clamp((radialDist - 130.0) / 320.0, 0.0, 1.0);

                    // Plasma noise
                    vec2 turbUv = vec2(rotatedAngle * 2.0, normalizedRadius * 8.0);
                    float turb = fbm(turbUv + uTime * 0.1);
                    float swirl = sin(rotatedAngle * 4.0 + normalizedRadius * 12.0 + turb * 2.0) * 0.4 + 0.6;
                    
                    float density = radialMask * heightFalloff * swirl;
                    
                    if (density > 0.01) {
                        // Temperature and base color
                        float temp = 1.0 - pow(normalizedRadius, 0.6);
                        vec3 innerColor = vec3(1.0, 0.8, 0.5);
                        vec3 midColor = vec3(0.9, 0.35, 0.1);
                        vec3 outerColor = vec3(0.4, 0.1, 0.05);

                        vec3 color;
                        if (temp > 0.5) {
                            color = mix(midColor, innerColor, (temp - 0.5) * 2.0);
                        } else {
                            color = mix(outerColor, midColor, temp * 2.0);
                        }

                        // Doppler beaming - calculate orbital velocity and its projection to ray
                        vec3 tangent = normalize(cross(uDiskNormal, radialVec)); // Orbital direction
                        float dopplerFactor = dot(tangent, rd); // Shift based on relative motion
                        
                        vec3 blueShift = vec3(0.6, 0.7, 1.0);
                        vec3 redShift = vec3(0.9, 0.2, 0.05);
                        
                        // Multiply color and add brightness
                        color = mix(color, blueShift, max(0.0, dopplerFactor * 1.5));
                        color = mix(color, redShift, max(0.0, -dopplerFactor * 1.0));
                        
                        // Brightness boosting on approaching side
                        float dopplerBright = 1.0 + dopplerFactor * 1.2;
                        
                        accumColor += color * density * dopplerBright * 0.05;
                    }
                }
            }

            float intensity = length(accumColor) * uIntensity;
            gl_FragColor = vec4(accumColor * uIntensity, intensity * activeRay);
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
        ditherStrength: { value: 0.0 },
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
            minScale: 0.58,
            maxScale: 1.0,
            targetMs: 16.6,
            emaMs: 16.6,
            adjustInterval: 0.25,
            elapsed: 0,
        };
        this.performanceState = {
            nextLensingComputeAt: 0,
            burstComputeActiveUntil: 0,
            bloomDownsample: 0.8,
            particleComputeAccumulator: 0,
            hawkingUpdateAccumulator: 0,
        };
        this.hiddenLegacyGlobals = [];
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
        this.burstComputeBanks = [];
        this.burstSparkBanks = [];
        this.burstCapacityBase = 0;
        this.burstCapacityMax = 0;
        this.burstRequestQueue = [];
        this.nextBurstBankIndex = 0;
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
        this.burstSparksPool = []; // Fallback pool path when compute burst banks are unavailable
        this.burstPoolSize = 24; // Maximum simultaneous bursts
        this.nextBurstIndex = 0; // Round-robin index for fallback pool allocation
        this.pendingBurstPoolTriggers = 0; // Queue combo bursts when pool is temporarily saturated
        this.pendingBurstPoolOrigin = new THREE.Vector3(); // Shared anchor for queued fallback bursts
        this.nextBurstParticleIndex = 0; // Ring allocator for combo burst particles
        this.nextJetParticleIndex = 0; // Ring allocator for jet particles
        this.comboSpawnReuseUntil = null; // Per-particle reuse lock to avoid combo overwrite resets
        this.comboBurstAnchor = new THREE.Vector3(); // Stable center for closely chained combos
        this.comboBurstAnchorUntil = 0;
        this.comboScatterHoldUntil = 0; // Keep combo particles outward before allowing recycle

        // Cached disk-tilt trigonometry (disk rotates -PI*0.42 around X).
        // Hot-looped in updateParticles, spawnBurstParticles and initParticle.
        this.diskTiltAngle = -Math.PI * 0.42;
        this.diskCosTilt = Math.cos(this.diskTiltAngle);
        this.diskSinTilt = Math.sin(this.diskTiltAngle);

        // Pre-allocated color instances for spawn paths (avoid GC churn during combos).
        this._burstColorWhite = new THREE.Color(1.0, 1.0, 0.9);
        this._burstColorOrange = new THREE.Color(1.0, 0.7, 0.2);
        this._burstColorCyan = new THREE.Color(0.4, 0.8, 1.0);
        this._hawkingColorBlue = new THREE.Color(0x88ccff);
        this._hawkingColorPink = new THREE.Color(0xffbbdd);
        this._jetColorBlue = new THREE.Color(0.4, 0.6, 1.0);
        this._jetColorRed = new THREE.Color(1.0, 0.3, 0.2);
        this._hasAnyBurstComputeNode = false;

        // Effect state
        this.diskIntensity = 1.0;
        this.diskTargetIntensity = 1.0;
        this.coreIntensity = 1.0;
        this.coreTargetIntensity = 1.0;
        this.diskRotationSpeed = 1.0;
        this.diskTargetRotationSpeed = 1.0;
        this.diskDopplerBoost = 1.0;
        this.diskEventHorizon = 110.0;
        this.starFlashIntensity = 0;
        this.bloomPulseIntensity = 0;
        this.starFlashIntensity = 0;
        this.bloomPulseIntensity = 0;
        this.chromaticPulse = 0;
        this.particleEventBoost = 0;
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
        // Lowered Z from 800 to 500 to bring the black hole closer
        this.cameraBasePosition = new THREE.Vector3(0, 200, 500);
        this.cameraTargetPosition = this.cameraBasePosition.clone();
        this.cameraLookTarget = new THREE.Vector3(0, 0, 0);
        this.cameraLookTargetSmoothed = new THREE.Vector3(0, 0, 0);
        this.cameraBaseFov = 60;
        this.cameraRoll = 0;
        this.cameraRollQuat = new THREE.Quaternion();
        this.cameraRollAxis = new THREE.Vector3(0, 0, 1);
        this.cameraPhaseX = this.random() * Math.PI * 2;
        this.cameraPhaseY = this.random() * Math.PI * 2;
        this.cameraPhaseZ = this.random() * Math.PI * 2;

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

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

    getVolumetricRaymarchOptions() {
        const quality = this.getCurrentQualityLevel();
        switch (quality) {
        case 'Extreme':
            return { steps: 14, fbmOctaves: 2 };
        case 'Ultra':
            return { steps: 10, fbmOctaves: 1 };
        case 'High':
        default:
            return { steps: 8, fbmOctaves: 1 };
        }
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

        const { backend } = this.renderer;
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
        // Keep starfield temporally stable: lensing updates can introduce micro shimmer on tiny points.
        const useLensing = false;
        const useUnifiedParticles = useCompute && !this.flags.noUnified;

        this.flags.usePost = usePost;
        this.flags.useMRT = useMRT;
        this.flags.useCompute = useCompute;
        this.flags.useLensing = useLensing;
        this.flags.useUnifiedParticles = useUnifiedParticles;
        this.flags.useVolume = !this.flags.noVolume && (this.qualityPreset.enableVolumetricDisk ?? true);
        this.flags.useBloom = usePost;
        this.flags.useChromatic = usePost && this.qualityPreset.enableChromatic !== false;
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
            this.dynamicResolution.minScale = this.qualityPreset.minRenderScale ?? 0.5;
            this.dynamicResolution.maxScale = 1.0;
            this.dynamicResolution.emaMs = 16.6;
            this.dynamicResolution.elapsed = 0;
        }
        if (this.performanceState) {
            this.performanceState.nextLensingComputeAt = 0;
            this.performanceState.burstComputeActiveUntil = 0;
            this.performanceState.bloomDownsample = this.qualityPreset.bloomDownsample ?? 0.58;
            this.performanceState.particleComputeAccumulator = 0;
            this.performanceState.hawkingUpdateAccumulator = 0;
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
        const initialDrift = this.computeDriftPosition(0);
        this.driftX = initialDrift.x;
        this.driftY = initialDrift.y;
        this.driftZ = initialDrift.z;

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
        this.applyBlackHoleDriftState();
        this.createParticleSystem();
        this.createHawkingRadiation();
        this.createBurstSparks();
        this.applyBlackHoleDriftState();
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

        // Some legacy builds also mounted a global star layer outside this container.
        // Keep it hidden while this Three.js theme is active to avoid double starfields.
        const hideGlobal = (el) => {
            if (!el) return;
            if (!this.hiddenLegacyGlobals.some((entry) => entry.el === el)) {
                this.hiddenLegacyGlobals.push({
                    el,
                    style: el.getAttribute('style'),
                });
            }
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('animation', 'none', 'important');
        };
        document.querySelectorAll('#stars').forEach(hideGlobal);
        document.querySelectorAll('.background-container .star').forEach(hideGlobal);

        console.log('[BlackHole] Hidden old DOM elements');
    }

    computeDriftPosition(timeSeconds = this.time) {
        // Increased range from 0.35 to 0.5 to allow it to float across the full screen
        const widthRange = window.innerWidth * 0.5;
        const heightRange = window.innerHeight * 0.5;
        const depthRange = 250; // Move up to 250 units closer or further
        const t = timeSeconds * 0.05; // Speed up drift so it floats noticeably

        const x = (Math.sin(t + this.driftPhaseX) + Math.cos(t * 1.34 + this.driftPhaseX)) * 0.5 * widthRange;
        const y = (Math.cos(t * 0.89 + this.driftPhaseY) + Math.sin(t * 1.67 + this.driftPhaseY)) * 0.5 * heightRange;
        const z = (Math.sin(t * 0.73 + this.driftPhaseX) + Math.cos(t * 1.1 + this.driftPhaseY)) * 0.5 * depthRange;

        return { x, y, z };
    }

    applyBlackHoleDriftState() {
        const x = this.driftX || 0;
        const y = this.driftY || 0;
        const z = this.driftZ || 0;

        if (this.blackHoleCore) {
            this.blackHoleCore.position.x = x;
            this.blackHoleCore.position.y = y;
            this.blackHoleCore.position.z = z;
        }
        if (this.eventHorizonSphere) {
            this.eventHorizonSphere.position.x = x;
            this.eventHorizonSphere.position.y = y;
            this.eventHorizonSphere.position.z = z;
        }
        if (this.accretionDisk) {
            this.accretionDisk.position.x = x;
            this.accretionDisk.position.y = y;
            this.accretionDisk.position.z = z;
        }
        if (this.innerDisk) {
            this.innerDisk.position.x = x;
            this.innerDisk.position.y = y;
            this.innerDisk.position.z = z;
        }
        if (this.accretionVolumeLayers.length) {
            this.accretionVolumeLayers.forEach((layer) => {
                layer.position.x = x;
                layer.position.y = y;
                layer.position.z = z;
                this.setMaterialUniformVec3(layer?.material, 'uCenter', x, y, z);
            });
        }
        if (this.hawkingParticles) {
            this.hawkingParticles.position.x = x;
            this.hawkingParticles.position.y = y;
            this.hawkingParticles.position.z = z;
        }
        if (this.photonSphere) {
            this.photonSphere.position.x = x;
            this.photonSphere.position.y = y;
            this.photonSphere.position.z = z;
        }

        this.setMaterialUniformVec3(this.starfield?.material, 'uBlackHolePos', x, y, z);
        this.setMaterialUniformVec3(this.particles?.material, 'uBlackHolePos', x, y, z);
        this.setMaterialUniformVec3(this.burstSparks?.material, 'uBlackHolePos', x, y, z);
        if (this.burstSparkBanks.length) {
            this.burstSparkBanks.forEach((burstSparks) => {
                this.setMaterialUniformVec3(burstSparks?.material, 'uBlackHolePos', x, y, z);
            });
        }
        if (this.burstSparksPool.length) {
            this.burstSparksPool.forEach((burstSparks) => {
                this.setMaterialUniformVec3(burstSparks?.material, 'uBlackHolePos', x, y, z);
            });
        }
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
        this.renderer.sortObjects = this.qualityPreset.sortObjects !== false;
        this.renderer.autoClear = false;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Camera looking at center, slightly above for dramatic angle
        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        this.camera.position.copy(this.cameraBasePosition);
        this.camera.lookAt(this.cameraLookTarget);
        this.cameraBaseFov = this.camera.fov;
        this.cameraTargetPosition.copy(this.cameraBasePosition);
        this.cameraLookTargetSmoothed.copy(this.cameraLookTarget);

        // Ambient light (very dim)
        const ambientLight = new THREE.AmbientLight(0x202030, 0.3);
        this.scene.add(ambientLight);

        this.probeWebGPUCapabilities();

        console.log('[BlackHole] Renderer initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Starfield - 3D Points with static glow
    // ─────────────────────────────────────────────────────────────────────────

    createStarfield() {
        const { starCount } = this.qualityPreset;
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinkles = new Float32Array(starCount);

        const starColors = [
            new THREE.Color(0xf0d6b3), // Warm champagne
            new THREE.Color(0xd5a36d), // Amber
            new THREE.Color(0xc48b5d), // Copper
            new THREE.Color(0xb8a6d4), // Dusty lavender
            new THREE.Color(0x9fb8d6), // Muted blue
        ];
        const tau = Math.PI * 2;
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const fullSkyCount = starCount; // Use all stars for the sky dome

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;

            // Uniform spherical distribution
            // x, y, z uniform on sphere surface
            const u = this.random();
            const v = this.random();
            const theta = 2 * Math.PI * u;
            const phi = Math.acos(2 * v - 1);

            let dirX = Math.sin(phi) * Math.cos(theta);
            let dirY = Math.sin(phi) * Math.sin(theta);
            let dirZ = Math.cos(phi);

            // Tiny jitter keeps the sky organic
            const jitter = 0.022;
            dirX += (this.random() - 0.5) * jitter;
            dirY += (this.random() - 0.5) * jitter;
            dirZ += (this.random() - 0.5) * jitter;

            // Normalize
            const invLen = 1 / Math.max(1e-4, Math.hypot(dirX, dirY, dirZ));
            dirX *= invLen;
            dirY *= invLen;
            dirZ *= invLen;

            // Place stars far away
            const radius = 2500 + (this.random() ** 0.9) * 3000;

            positions[i3] = dirX * radius;
            positions[i3 + 1] = dirY * radius;
            positions[i3 + 2] = dirZ * radius;

            // Color selection
            const colorRoll = this.random();
            let color = starColors[0];
            if (colorRoll > 0.62 && colorRoll <= 0.86) color = starColors[1];
            else if (colorRoll > 0.86 && colorRoll <= 0.95) color = starColors[2];
            else if (colorRoll > 0.95 && colorRoll <= 0.985) color = starColors[3];
            else if (colorRoll > 0.985) color = starColors[4];

            const colorGain = 0.62 + this.random() * 0.4;
            colors[i3] = Math.min(1.0, color.r * colorGain);
            colors[i3 + 1] = Math.min(1.0, color.g * colorGain);
            colors[i3 + 2] = Math.min(1.0, color.b * colorGain);

            // Size and twinkle
            const magnitude = this.random();
            if (magnitude < 0.005) {
                sizes[i] = 5.8 + this.random() * 2.5; // Rare bright stars
            } else if (magnitude < 0.05) {
                sizes[i] = 3.8 + this.random() * 1.8;
            } else if (magnitude < 0.25) {
                sizes[i] = 2.8 + this.random() * 1.2;
            } else {
                sizes[i] = 2.0 + this.random() * 1.0;
            }

            twinkles[i] = magnitude < 0.05
                ? 0.52 + this.random() * 0.2
                : 0.35 + this.random() * 0.15;
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
            sprite.geometry.setAttribute('instanceTwinkle', new THREE.InstancedBufferAttribute(twinkles, 1));
            sprite.frustumCulled = false;
            sprite.renderOrder = -20;
            this.starfield = sprite;
        } else {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            geometry.setAttribute('twinkle', new THREE.BufferAttribute(twinkles, 1));
            geometry.setDrawRange(0, starCount);

            // Custom shader material for static-luma stars
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uBlackHolePos: { value: new THREE.Vector3(0, 0, 0) },
                },
                vertexShader: `
                    uniform vec3 uBlackHolePos;
                    attribute float size;
                    attribute float twinkle;
                    varying vec3 vColor;
                    varying float vLuma;
                    varying vec2 vPos;
                    varying float vStretchZone;
                    
                    void main() {
                        vColor = color;
                        vLuma = twinkle;
                        vPos = position.xy;
                        float distToCenter = length(vPos - uBlackHolePos.xy);
                        vStretchZone = smoothstep(760.0, 260.0, distToCenter);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        float targetSize = size * (1200.0 / -mvPosition.z) * (1.0 + vStretchZone * 0.12);
                        gl_PointSize = clamp(targetSize, 2.6, 15.0);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform vec3 uBlackHolePos;
                    varying vec3 vColor;
                    varying float vLuma;
                    varying vec2 vPos;
                    varying float vStretchZone;
                    
                    void main() {
                        vec2 toCenter = vPos - uBlackHolePos.xy;
                        float stretch = 1.0 + vStretchZone * 0.55;

                        vec2 dir = normalize(toCenter + vec2(0.0001));
                        vec2 perp = vec2(-dir.y, dir.x);
                        vec2 center = gl_PointCoord - 0.5;
                        float along = dot(center, dir);
                        float across = dot(center, perp);
                        vec2 stretched = vec2(along, across / stretch);

                        float dist = length(stretched);
                        if (dist > 0.5) discard;
                        
                        float starLuma = clamp(vLuma, 0.4, 0.9);
                        float radial = max(0.0, 1.0 - dist * 2.0);
                        float halo = pow(radial, 1.9);
                        float core = smoothstep(0.2, 0.0, dist);
                        float alpha = (halo * 0.26 + core * 0.42) * starLuma;
                        vec3 color = mix(vColor, vec3(1.0), core * 0.08) * (0.68 + starLuma * 0.22);

                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                vertexColors: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });

            this.starfield = new THREE.Points(geometry, material);
            this.starfield.userData.baseCount = starCount;
            this.starfield.renderOrder = -20;
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
        material.forceSinglePass = true;

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
            ? createBlackHoleCoreNodeMaterial({ noiseOctaves: this.qualityPreset.materialNoiseOctaves ?? 3 })
            : new THREE.ShaderMaterial({
                uniforms: { ...BlackHoleShader.uniforms },
                vertexShader: BlackHoleShader.vertexShader,
                fragmentShader: BlackHoleShader.fragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
        material.forceSinglePass = true;

        this.blackHoleCore = new THREE.Mesh(geometry, material);
        this.blackHoleCore.position.set(0, 0, 0);
        this.blackHoleCore.renderOrder = 100;
        this.scene.add(this.blackHoleCore);

        // Inner black sphere (solid event horizon) - LARGER
        const horizonSegments = this.getCurrentQualityLevel() === 'High' ? 32 : 48;
        const blackGeometry = new THREE.SphereGeometry(120, horizonSegments, horizonSegments);
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

        const photonSegments = Math.max(64, Math.min(128, this.qualityPreset.diskSegments * 2));
        const geometry = new THREE.RingGeometry(135, 175, photonSegments);
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
        material.forceSinglePass = true;

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

        // Create a smaller, more refined base disk
        const innerRadius = 140;
        const outerRadius = 400;
        const baseGeometry = new THREE.RingGeometry(innerRadius, outerRadius, segments, 6);

        // Core opaque disk material
        const material = this.isWebGPU
            ? createAccretionDiskNodeMaterial({ noiseOctaves: this.qualityPreset.materialNoiseOctaves ?? 3 })
            : new THREE.ShaderMaterial({
                uniforms: { ...AccretionDiskShader.uniforms },
                vertexShader: AccretionDiskShader.vertexShader,
                fragmentShader: AccretionDiskShader.fragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });
        material.forceSinglePass = true;

        this.accretionDisk = new THREE.Mesh(baseGeometry, material);
        this.accretionDisk.rotation.x = -Math.PI * 0.42;
        this.accretionDisk.position.set(0, 0, 0);
        this.accretionDisk.renderOrder = 50;
        this.scene.add(this.accretionDisk);

        // Volumetric curved raymarching disk
        if (this.accretionVolumeLayers.length) {
            this.accretionVolumeLayers.forEach((layer) => {
                this.scene.remove(layer);
                if (layer.geometry) layer.geometry.dispose();
                if (layer.material) layer.material.dispose();
            });
            this.accretionVolumeLayers = [];
        }

        if (this.flags.useVolume) {
            // Flattened bounding volume - the disk only exists for |height|<40 in a 130-450 radius,
            // so a tall 1600^3 box was pure fill-rate waste. A 1600x400x1600 slab halves pixel
            // coverage at typical camera angles while still enclosing the tilted disk + bending margin.
            const volumeGeometry = new THREE.BoxGeometry(1600, 400, 1600);

            const diskNormal = new THREE.Vector3(0, Math.sin(Math.PI * 0.42), Math.cos(Math.PI * 0.42)).normalize();

            const volumeOptions = this.getVolumetricRaymarchOptions();
            const volumeMaterial = this.isWebGPU
                ? createVolumetricAccretionDiskNodeMaterial(diskNormal, volumeOptions)
                : new THREE.ShaderMaterial({
                    uniforms: {
                        ...VolumetricAccretionDiskShader.uniforms,
                        uDiskNormal: { value: diskNormal },
                    },
                    vertexShader: VolumetricAccretionDiskShader.vertexShader,
                    fragmentShader: VolumetricAccretionDiskShader.fragmentShader,
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                    side: THREE.BackSide, // Raymarch once from backfaces to avoid near-plane clipping
                });
            const volume = new THREE.Mesh(volumeGeometry, volumeMaterial);
            volume.renderOrder = 48;
            this.accretionVolumeLayers.push(volume);
            this.scene.add(volume);
        } else {
            const volumeCount = this.qualityPreset.layeredDiskCount ?? 2;
            for (let i = 0; i < volumeCount; i++) {
                const layerMaterial = this.isWebGPU
                    ? createAccretionDiskNodeMaterial({ noiseOctaves: this.qualityPreset.materialNoiseOctaves ?? 3 })
                    : material.clone();
                const intensity = 0.18 + i * 0.08;
                if (layerMaterial.uniforms?.uIntensity) {
                    layerMaterial.uniforms.uIntensity.value = intensity;
                } else if (layerMaterial.userData?.uIntensity) {
                    layerMaterial.userData.uIntensity.value = intensity;
                }
                layerMaterial.blending = THREE.AdditiveBlending;
                layerMaterial.depthWrite = false;
                layerMaterial.forceSinglePass = true;

                const layer = new THREE.Mesh(baseGeometry.clone(), layerMaterial);
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
            new THREE.Color(0xffc48a), // Warm amber
            new THREE.Color(0xffad74), // Soft orange
            new THREE.Color(0xf1b1ff), // Lavender
            new THREE.Color(0x9bc7ff), // Soft blue
            new THREE.Color(0xff9fc8), // Rose
        ];

        for (let i = 0; i < particleCount; i++) {
            this.initParticle(
                i,
                positions,
                velocities,
                colors,
                sizes,
                lifetimes,
                particleColors,
                this.driftX || 0,
                this.driftY || 0,
                this.driftZ || 0,
            );
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
            sprite.renderOrder = 55;

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
                    uEventBoost: { value: 1.0 },
                    uBlackHolePos: { value: new THREE.Vector3(0, 0, 0) },
                },
                vertexShader: `
                    uniform vec3 uBlackHolePos;
                    attribute float size;
                    attribute float lifetime;
                    varying vec3 vColor;
                    varying float vLifetime;

                    void main() {
                        vColor = color;
                        vLifetime = lifetime;
                        vec3 pos = position + uBlackHolePos;
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                        gl_PointSize = size * (200.0 / -mvPosition.z);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform float uEventBoost;
                    varying vec3 vColor;
                    varying float vLifetime;

                    void main() {
                        float dist = length(gl_PointCoord - 0.5);
                        if (dist > 0.5) discard;

                        float alpha = (1.0 - dist * 2.0) * min(1.0, vLifetime);
                        vec3 color = vColor * (1.0 + (1.0 - vLifetime) * 0.5) * uEventBoost;

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
            this.particles.renderOrder = 55;
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
            ? this._hawkingColorBlue
            : this._hawkingColorPink;

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
                    uIntensity: { value: 1.0 },
                    uBlackHolePos: { value: new THREE.Vector3(0, 0, 0) },
                },
                vertexShader: `
                    uniform vec3 uBlackHolePos;
                    attribute float size;
                    attribute float lifetime;
                    varying vec3 vColor;
                    varying float vLifetime;

                    void main() {
                        vColor = color;
                        vLifetime = lifetime;
                        vec3 pos = position + uBlackHolePos;
                        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
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

        const activeCount = Math.min(
            lifetimes.length,
            this.hawkingParticles?.geometry?.drawRange?.count ?? lifetimes.length,
        );
        for (let i = 0; i < activeCount; i += 1) {
            const i3 = i * 3;

            positions[i3] += velocities[i3] * delta;
            positions[i3 + 1] += velocities[i3 + 1] * delta;
            positions[i3 + 2] += velocities[i3 + 2] * delta;

            const angle = swirl[i] * delta;
            // Small-angle approximation: cos(a)≈1-a²/2, sin(a)≈a (error < 0.001 for angles < 0.1 rad)
            const a2 = angle * angle;
            const cosA = 1 - a2 * 0.5;
            const sinA = angle;
            const px = positions[i3];
            const py = positions[i3 + 1];
            positions[i3] = px * cosA - py * sinA;
            positions[i3 + 1] = px * sinA + py * cosA;

            ages[i] += delta;
            const t = ages[i] / lifeSpans[i];
            const life = t >= 1 ? 0 : 1 - t;
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

        if (!this.isWebGPU && this.hawkingParticles?.material) {
            this.setMaterialUniformVec3(this.hawkingParticles.material, 'uBlackHolePos', this.driftX || 0, this.driftY || 0, this.driftZ || 0);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dynamic Resolution + LOD
    // ─────────────────────────────────────────────────────────────────────────

    getDynamicPixelRatio() {
        const baseRatio = this.getEffectivePixelRatio(this.qualityPreset.maxPixelRatio ?? 1.5, 'theme');
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
        // Down-scale more aggressively when the EMA is significantly over budget (combos / burst
        // surges), and step gently on the way back up so we don't oscillate.
        if (drs.emaMs > drs.targetMs * 1.2) {
            newScale = Math.max(drs.minScale, drs.scale - 0.08);
        } else if (drs.emaMs > drs.targetMs * 1.12) {
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

        const { scale } = drs;
        let starFactor = 1.0;
        let particleFactor = 1.0;
        let hawkingFactor = 1.0;

        if (scale < 0.72) {
            starFactor = 1.0;
            particleFactor = 0.52;
            hawkingFactor = 0.55;
        } else if (scale < 0.82) {
            starFactor = 1.0;
            particleFactor = 0.72;
            hawkingFactor = 0.75;
        } else if (scale < 0.9) {
            starFactor = 1.0;
            particleFactor = 0.86;
            hawkingFactor = 0.88;
        }

        if (this.starfield) {
            const baseCount = this.starfield.userData.baseCount || this.qualityPreset.starCount;
            const targetCount = Math.min(baseCount, Math.max(160, Math.floor(baseCount * starFactor)));
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
            const targetCount = Math.min(baseCount, Math.max(160, Math.floor(baseCount * particleFactor)));
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
            const targetCount = Math.min(baseCount, Math.max(60, Math.floor(baseCount * hawkingFactor)));
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

    getLensingUpdateInterval() {
        const scale = this.dynamicResolution?.enabled ? this.dynamicResolution.scale : 1.0;
        if (scale >= 0.9) return 0;
        if (scale >= 0.82) return 1 / 90;
        if (scale >= 0.74) return 1 / 72;
        return 1 / 60;
    }

    getAdaptiveBloomDownsample() {
        const drs = this.dynamicResolution;
        const base = this.qualityPreset.bloomDownsample ?? 0.58;
        const minScale = this.qualityPreset.bloomMinDownsample ?? Math.min(base, 0.48);
        if (!drs?.enabled) return base;

        let target = base;
        if (drs.scale < 0.75 || drs.emaMs > drs.targetMs * 1.2) {
            target = Math.min(base, minScale);
        } else if (drs.scale < 0.85 || drs.emaMs > drs.targetMs * 1.08) {
            target = Math.min(base, Math.max(minScale, base * 0.82));
        } else if (drs.scale < 0.93 || drs.emaMs > drs.targetMs * 1.02) {
            target = Math.min(base, Math.max(minScale, base * 0.92));
        }

        this.performanceState.bloomDownsample += (target - this.performanceState.bloomDownsample) * 0.2;
        return Math.min(base, Math.max(minScale, this.performanceState.bloomDownsample));
    }

    shouldRunBurstCompute() {
        if (!this._hasAnyBurstComputeNode) return false;
        // Cheap checks first - only scan for active particles if none of the fast triggers fired.
        if (this.burstPhase
            || this.burstFactor > 0.01
            || this.time <= this.performanceState.burstComputeActiveUntil
            || this.burstRequestQueue.length > 0) {
            return true;
        }
        for (let i = 0; i < this.burstComputeBanks.length; i += 1) {
            if (this.burstComputeBanks[i]?.hasActiveParticles?.(this.time)) return true;
        }
        return false;
    }

    getParticleComputeInterval() {
        const active = this.burstPhase
            || this.burstFactor > 0.05
            || this.gravitySurgeFactor > 0.12
            || this.particleEventBoost > 0.08
            || this.time <= this.comboScatterHoldUntil;
        if (active) return 0;
        return this.qualityPreset.particleComputeInterval ?? 0;
    }

    getHawkingUpdateInterval() {
        const active = this.hawkingIntensity > 1.08
            || this.hawkingTargetIntensity > 1.08
            || this.photonSpherePulse > 0.08
            || this.burstFactor > 0.08;
        if (active) return 0;
        return this.qualityPreset.hawkingUpdateInterval ?? 0;
    }

    getBlackHoleCorePosition(target = this.computeBlackHolePos) {
        if (this.blackHoleCore?.position) {
            target.copy(this.blackHoleCore.position);
            return target;
        }
        target.set(this.driftX || 0, this.driftY || 0, this.driftZ || 0);
        return target;
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

        const { backend } = this.renderer;
        const compute = {};
        const addTiming = (label, node) => {
            if (!node) return;
            const uid = backend.getTimestampUID(node);
            if (backend.hasTimestamp(uid)) {
                compute[label] = backend.getTimestamp(uid);
            }
        };

        addTiming('particles', this.particleCompute?.computeNode);
        this.burstComputeBanks.forEach((burstCompute, index) => {
            addTiming(`burst-${index}`, burstCompute?.computeNode);
        });
        if (!this.burstComputeBanks.length) {
            addTiming('burst', this.burstCompute?.computeNode);
        }
        addTiming('lensing', this.starLensingCompute?.computeNode);

        this.gpuTimings.compute = compute;

        if (this.flags.baseline && Object.keys(compute).length) {
            console.log('[BlackHole] GPU compute timings (ms):', compute);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Burst Sparks - Explosive shader-driven particles from event horizon
    // ─────────────────────────────────────────────────────────────────────────

    getBurstComputeTotalCapacity() {
        return this.burstComputeBanks.reduce((sum, burstCompute) => sum + (burstCompute?.count || 0), 0);
    }

    disposeBurstComputeBanks() {
        this.burstSparkBanks.forEach((burstSparks) => {
            if (burstSparks?.geometry) burstSparks.geometry.dispose();
            if (burstSparks?.material) burstSparks.material.dispose();
            this.scene?.remove(burstSparks);
        });
        this.burstSparkBanks = [];

        this.burstComputeBanks.forEach((burstCompute) => {
            burstCompute?.dispose?.();
        });
        this.burstComputeBanks = [];

        this.burstCompute = null;
        this.burstSparks = null;
        this.nextBurstBankIndex = 0;
        this._hasAnyBurstComputeNode = false;
    }

    createBurstComputeBank(count, colorOptions = null) {
        const bankCount = Math.max(0, Math.floor(count));
        if (bankCount <= 0 || !this.isWebGPU || !this.flags.useCompute) return false;

        const palette = colorOptions || [
            new THREE.Color(0xffaa44),
            new THREE.Color(0xff6622),
            new THREE.Color(0x44aaff),
            new THREE.Color(0xaa66ff),
            new THREE.Color(0xffffff),
            new THREE.Color(0xff44aa),
        ];

        const angles = new Float32Array(bankCount * 2);
        const colors = new Float32Array(bankCount * 3);
        const sizes = new Float32Array(bankCount);
        const randoms = new Float32Array(bankCount);

        for (let i = 0; i < bankCount; i += 1) {
            const theta = this.random() * Math.PI * 2;
            const phi = Math.acos(2 * this.random() - 1);
            angles[i * 2] = theta;
            angles[i * 2 + 1] = phi;
            randoms[i] = this.random();

            const colorType = this.random();
            let c;
            if (colorType > 0.5) c = palette[0];
            else if (colorType > 0.3) c = palette[1];
            else if (colorType > 0.15) c = palette[2];
            else if (colorType > 0.05) c = palette[3];
            else c = palette[4];

            const i3 = i * 3;
            colors[i3] = c.r;
            colors[i3 + 1] = c.g;
            colors[i3 + 2] = c.b;
            sizes[i] = 5 + this.random() * 8;
        }

        let burstCompute = null;
        let burstSparks = null;
        try {
            burstCompute = new BlackHoleBurstCompute(bankCount, {
                lifetimeSeconds: this.qualityPreset.burstLifetimeSeconds,
            });
            burstCompute.setInitialState(angles, colors, sizes, randoms);
            burstCompute.createComputeNode();

            const material = createBurstSparkNodeMaterial({
                isWebGPU: this.isWebGPU,
                burstCompute,
            });
            burstSparks = new THREE.Sprite(material);
            burstSparks.count = bankCount;
            burstSparks.geometry = burstSparks.geometry.clone();
            burstSparks.geometry.setAttribute(
                'instancePosition',
                new THREE.InstancedBufferAttribute(new Float32Array(bankCount * 3), 3),
            );
            burstSparks.frustumCulled = false;
            burstSparks.renderOrder = 70;

            this.scene.add(burstSparks);
            this.burstComputeBanks.push(burstCompute);
            this.burstSparkBanks.push(burstSparks);
            if (!this.burstCompute) this.burstCompute = burstCompute;
            if (!this.burstSparks) this.burstSparks = burstSparks;
            if (burstCompute?.computeNode) this._hasAnyBurstComputeNode = true;
            return true;
        } catch (error) {
            if (burstSparks) {
                if (burstSparks.geometry) burstSparks.geometry.dispose();
                if (burstSparks.material) burstSparks.material.dispose();
                this.scene?.remove(burstSparks);
            }
            burstCompute?.dispose?.();
            return false;
        }
    }

    ensureBurstCapacityFor(neededCount) {
        if (neededCount <= 0) return true;
        // Burst banks are pre-allocated up to burstCapacityMax during createBurstSparks(), so
        // we never compile shaders mid-gameplay. If we're already at cap, report "no more capacity".
        return false;
    }

    getBurstComputeSpawnCountForIntensity(intensity) {
        const clampedIntensity = Math.max(0.0, Math.min(1.0, intensity));
        const totalCapacity = Math.max(this.burstCapacityBase, this.getBurstComputeTotalCapacity());
        if (totalCapacity <= 0) return 0;
        const minFactor = this.qualityPreset.burstMinBatchFactor ?? 0.006;
        const maxFactor = this.qualityPreset.burstMaxBatchFactor ?? 0.04;
        const minBatchFloor = this.getCurrentQualityLevel() === 'High' ? 48 : 96;
        const minBatch = Math.max(minBatchFloor, Math.floor(totalCapacity * minFactor));
        const maxBatch = Math.max(minBatch, Math.floor(totalCapacity * maxFactor));
        return Math.min(
            totalCapacity,
            Math.floor(minBatch + (maxBatch - minBatch) * clampedIntensity),
        );
    }

    emitBurstParticles(requestedCount, seed = 0, queueOnOverflow = true) {
        let remaining = Math.max(0, Math.floor(requestedCount));
        if (remaining <= 0) {
            return { activated: 0, remaining: 0 };
        }

        let iterations = 0;
        while (remaining > 0) {
            const bankCount = this.burstComputeBanks.length;
            if (bankCount <= 0) break;

            const startIndex = this.nextBurstBankIndex % bankCount;
            for (let i = 0; i < bankCount && remaining > 0; i += 1) {
                const bankIndex = (startIndex + i) % bankCount;
                const burstCompute = this.burstComputeBanks[bankIndex];
                if (!burstCompute) continue;
                const result = burstCompute.activateParticles(
                    remaining,
                    this.time,
                    seed + bankIndex * 0.137 + i * 0.071,
                );
                remaining = result.remaining;
            }
            this.nextBurstBankIndex = bankCount > 0 ? (startIndex + 1) % bankCount : 0;

            if (remaining <= 0) break;
            if (!this.ensureBurstCapacityFor(remaining)) break;
            iterations += 1;
            if (iterations > 8) break;
        }

        const activated = Math.max(0, Math.floor(requestedCount) - remaining);
        if (remaining > 0 && queueOnOverflow) {
            this.burstRequestQueue.push({ count: remaining, seed });
        }
        return { activated, remaining };
    }

    drainBurstRequestQueue() {
        if (!this.burstRequestQueue.length || !this.burstComputeBanks.length) return;

        const maxQueueDrainsPerFrame = 6;
        let drained = 0;
        while (this.burstRequestQueue.length > 0 && drained < maxQueueDrainsPerFrame) {
            const nextRequest = this.burstRequestQueue[0];
            const result = this.emitBurstParticles(nextRequest.count, nextRequest.seed, false);
            if (result.remaining > 0) {
                nextRequest.count = result.remaining;
                break;
            }
            this.burstRequestQueue.shift();
            drained += 1;
        }
    }

    createBurstSparks() {
        const count = this.qualityPreset.burstSparkCount;
        const particlesPerBurst = Math.max(1, Math.floor(count / this.burstPoolSize));
        this.performanceState.burstComputeActiveUntil = 0;
        this.pendingBurstPoolTriggers = 0;
        this.pendingBurstPoolOrigin.set(0, 0, 0);
        this.comboBurstAnchorUntil = 0;
        this.comboScatterHoldUntil = 0;
        this.burstRequestQueue = [];
        this.nextBurstBankIndex = 0;
        this.burstCapacityBase = count;
        this.burstCapacityMax = Math.max(
            count,
            Math.floor(count * (this.qualityPreset.burstCapacityMultiplier ?? 1.25)),
        );

        // Color palette - cosmic hot colors
        const colorOptions = [
            new THREE.Color(0xffaa44), // Orange
            new THREE.Color(0xff6622), // Deep orange
            new THREE.Color(0x44aaff), // Cyan blue
            new THREE.Color(0xaa66ff), // Purple
            new THREE.Color(0xffffff), // White hot
            new THREE.Color(0xff44aa), // Pink
        ];

        this.disposeBurstComputeBanks();
        if (this.burstSparksPool.length) {
            this.burstSparksPool.forEach((burst) => {
                if (burst?.geometry) burst.geometry.dispose();
                if (burst?.material) burst.material.dispose();
                this.scene.remove(burst);
            });
            this.burstSparksPool = [];
        }

        if (this.isWebGPU && this.flags.useCompute) {
            try {
                const initialCount = Math.max(1, this.burstCapacityBase);
                const created = this.createBurstComputeBank(initialCount, colorOptions);
                if (!created) {
                    throw new Error('Failed to create initial burst compute bank');
                }
                // Pre-allocate remaining capacity so no shader compilation happens mid-gameplay.
                // Previously banks were created on-demand when combos saturated capacity, which
                // forced WebGPU pipeline compile on the main thread during combo chains.
                while (this.getBurstComputeTotalCapacity() < this.burstCapacityMax) {
                    const remaining = this.burstCapacityMax - this.getBurstComputeTotalCapacity();
                    const chunk = Math.min(this.burstCapacityBase, remaining);
                    if (chunk <= 0) break;
                    const ok = this.createBurstComputeBank(chunk, colorOptions);
                    if (!ok) break;
                }
                console.log(
                    '[BlackHole] Burst sparks compute banks initialized:',
                    this.getBurstComputeTotalCapacity(),
                    '/',
                    this.burstCapacityMax,
                    `(${this.burstComputeBanks.length} banks)`,
                );
                return;
            } catch (error) {
                console.warn('[BlackHole] Burst compute init failed, falling back to pool:', error);
                this.disposeBurstComputeBanks();
            }
        }

        this.burstCapacityBase = 0;
        this.burstCapacityMax = 0;
        this.burstRequestQueue = [];

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
                burstSparks.renderOrder = 70;
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
                        uBlackHolePos: { value: new THREE.Vector3(0, 0, 0) },
                    },
                    vertexShader: BurstSparkVertexShader,
                    fragmentShader: BurstSparkFragmentShader,
                    transparent: true,
                    depthWrite: false,
                    blending: THREE.AdditiveBlending,
                });

                const burstSparks = new THREE.Points(geometry, material);
                burstSparks.renderOrder = 70;
                this.burstSparksPool.push(burstSparks);
                this.scene.add(burstSparks);
            }
        }

        console.log('[BlackHole] Burst sparks pool created with', this.burstPoolSize, 'systems,', particlesPerBurst, 'particles each');
    }

    pickAmbientParticleColor(colorPalette) {
        const roll = this.random();
        if (roll < 0.38) return colorPalette[0];
        if (roll < 0.7) return colorPalette[1];
        if (roll < 0.88) return colorPalette[2];
        if (roll < 0.96) return colorPalette[3];
        return colorPalette[4];
    }

    initParticle(index, positions, velocities, colors, sizes, lifetimes, colorPalette, centerX = 0, centerY = 0, centerZ = 0) {
        const i3 = index * 3;

        // Spawn in a tighter torus around the accretion disk.
        const angle = this.random() * Math.PI * 2;
        const radius = 260 + this.random() * 360;
        const height = (this.random() - 0.5) * 70;

        // Flat coordinates
        const px = Math.cos(angle) * radius;
        let py = height;
        let pz = Math.sin(angle) * radius;

        // Apply tilt rotation (around X axis) - matches disk rotation
        const cosT = this.diskCosTilt;
        const sinT = this.diskSinTilt;

        // Rotate position
        const p_y = py * cosT - pz * sinT;
        const p_z = py * sinT + pz * cosT;
        py = p_y;
        pz = p_z;

        positions[i3] = centerX + px;
        positions[i3 + 1] = centerY + py;
        positions[i3 + 2] = centerZ + pz;

        // Initial velocity - Orbital motion (increased slightly to maintain orbit without forcing)
        const orbitalSpeed = 0.28 + this.random() * 0.22;

        // Tangential velocity on flat plane
        const vx = -Math.sin(angle) * orbitalSpeed;
        let vy = (this.random() - 0.5) * 0.03;
        let vz = Math.cos(angle) * orbitalSpeed;

        // Rotate velocity to match tilted plane
        const v_y = vy * cosT - vz * sinT;
        const v_z = vy * sinT + vz * cosT;
        vy = v_y;
        vz = v_z;

        velocities[i3] = vx;
        velocities[i3 + 1] = vy;
        velocities[i3 + 2] = vz;

        const color = this.pickAmbientParticleColor(colorPalette);
        colors[i3] = color.r;
        colors[i3 + 1] = color.g;
        colors[i3 + 2] = color.b;

        sizes[index] = 2.8 + this.random() * 3.6;
        lifetimes[index] = 0.64 + this.random() * 0.26;
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
            if (typeof value === 'number'
                && typeof material.uniforms[name].value === 'number'
                && Math.abs(material.uniforms[name].value - value) < 1e-4) {
                return;
            }
            material.uniforms[name].value = value;
            return;
        }
        const node = material.userData?.[name];
        if (node && 'value' in node) {
            if (typeof value === 'number'
                && typeof node.value === 'number'
                && Math.abs(node.value - value) < 1e-4) {
                return;
            }
            node.value = value;
        }
    }

    setMaterialUniformVec2(material, name, x, y) {
        if (!material) return;
        const uniformValue = material.uniforms?.[name]?.value;
        if (uniformValue?.set) {
            if (Math.abs((uniformValue.x ?? 0) - x) < 1e-4
                && Math.abs((uniformValue.y ?? 0) - y) < 1e-4) {
                return;
            }
            uniformValue.set(x, y);
            return;
        }
        const node = material.userData?.[name];
        if (node?.value?.set) {
            if (Math.abs((node.value.x ?? 0) - x) < 1e-4
                && Math.abs((node.value.y ?? 0) - y) < 1e-4) {
                return;
            }
            node.value.set(x, y);
        }
    }

    setMaterialUniformVec3(material, name, x, y, z) {
        if (!material) return;
        const uniformValue = material.uniforms?.[name]?.value;
        if (uniformValue?.set) {
            if (Math.abs((uniformValue.x ?? 0) - x) < 1e-4
                && Math.abs((uniformValue.y ?? 0) - y) < 1e-4
                && Math.abs((uniformValue.z ?? 0) - z) < 1e-4) {
                return;
            }
            uniformValue.set(x, y, z);
            return;
        }
        const node = material.userData?.[name];
        if (node?.value?.set) {
            if (Math.abs((node.value.x ?? 0) - x) < 1e-4
                && Math.abs((node.value.y ?? 0) - y) < 1e-4
                && Math.abs((node.value.z ?? 0) - z) < 1e-4) {
                return;
            }
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
        // Skip no-op writes for scalar floats. Avoids dirtying the TSL uniform
        // and scheduling redundant buffer uploads on WebGPU every frame.
        if (typeof value === 'number' && typeof current === 'number') {
            if (Math.abs(value - current) < 1e-4) return;
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
                bloomThreshold: 0.3,
                bloomDownsample: this.performanceState.bloomDownsample,
                enableChromatic: this.flags.useChromatic,
                chromaticStrength: this.flags.useChromatic ? 0.0006 : 0.0,
                vignetteOffset: 1.2,
                vignetteDarkness: 0.5,
                exposure: 1.05,
                contrast: 1.04,
                saturation: 1.08,
                tintStrength: 0.22,
                ditherStrength: 0.0,
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

        if (this.flags.useChromatic) {
            this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
            this.chromaticPass.uniforms.amount.value = 0.0006;
            this.composer.addPass(this.chromaticPass);
        }

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
        colorGradePass.uniforms.ditherStrength.value = 0.0;
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

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub, pointerUnsub);
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
        this.particleEventBoost = Math.min(1.2, this.particleEventBoost + 0.65);
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

        // Add heating to accretion disk
        this.diskDopplerBoost = Math.max(1.0, this.diskDopplerBoost + lineCount * 0.5);
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

        // Add extreme heating to accretion disk
        this.diskDopplerBoost = Math.min(4.0, this.diskDopplerBoost + comboCount * 1.5);

        // Ripple the event horizon
        this.diskEventHorizon = Math.max(70.0, this.diskEventHorizon - comboCount * 8.0);

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
            (this.isWebGPU && this.flags.useCompute && this._hasAnyBurstComputeNode)
            || this.burstSparksPool.length > 0,
        );
    }

    resolveComboBurstOrigin(target = this.computeBlackHolePos) {
        // Keep a shared burst center for rapid combo chains so bursts stack,
        // while allowing the anchor to refresh after a brief quiet gap.
        const anchorHoldSeconds = 5.0;
        if (this.time > this.comboBurstAnchorUntil) {
            this.getBlackHoleCorePosition(this.comboBurstAnchor);
        }
        this.comboBurstAnchorUntil = this.time + anchorHoldSeconds;
        target.copy(this.comboBurstAnchor);
        return target;
    }

    triggerComboBurst(comboCount, surgeGain, burstGain) {
        if (!this.isActive) return;

        const scatterHoldSeconds = (this.qualityPreset.comboScatterBaseSeconds ?? 8.0)
            + Math.min(
                this.qualityPreset.comboScatterMaxBonusSeconds ?? 3.0,
                comboCount * (this.qualityPreset.comboScatterComboSeconds ?? 0.25),
            );
        this.comboScatterHoldUntil = Math.max(this.comboScatterHoldUntil, this.time + scatterHoldSeconds);

        // Keep combo forces additive: bursts add energy instead of subtracting suction.
        this.gravitySurgeFactor = Math.min(40.0, this.gravitySurgeFactor + surgeGain * 0.35);
        this.burstPhase = true;
        this.burstFactor = Math.min(40.0, this.burstFactor + burstGain);

        this.starFlashIntensity = Math.min(1.8, this.starFlashIntensity + 0.18 + comboCount * 0.12);
        this.bloomPulseIntensity = Math.min(1.2, this.bloomPulseIntensity + 0.14 + comboCount * 0.08);
        this.chromaticPulse = Math.min(0.03, this.chromaticPulse + 0.004 + comboCount * 0.0015);

        // Prefer dedicated burst systems (like Galaxy/Blood Moon behavior).
        if (this.isWebGPU && this.flags.useCompute && this._hasAnyBurstComputeNode) {
            const triggerCount = Math.min(1 + Math.floor(comboCount / 6), 2);
            for (let i = 0; i < triggerCount; i++) {
                const intensity = Math.min(0.9, comboCount / 12 + i * 0.06);
                const requestedCount = this.getBurstComputeSpawnCountForIntensity(intensity);
                this.emitBurstParticles(requestedCount, this.random() * Math.PI * 2, true);
            }
            const activeWindow = Math.max(
                6.0,
                (this.qualityPreset.burstLifetimeSeconds ?? 11.0) + comboCount * 0.2,
            );
            this.performanceState.burstComputeActiveUntil = Math.max(
                this.performanceState.burstComputeActiveUntil,
                this.time + activeWindow,
            );
        } else if (this.burstSparksPool.length > 0) {
            const systemsToTrigger = Math.min(1 + Math.floor(comboCount / 6), this.burstSparksPool.length, 2);
            let triggered = 0;
            let scanned = 0;
            const startIndex = this.nextBurstIndex;
            const burstOrigin = this.resolveComboBurstOrigin(this.computeBlackHolePos);

            while (triggered < systemsToTrigger && scanned < this.burstSparksPool.length) {
                const index = (startIndex + scanned) % this.burstSparksPool.length;
                const burstSparks = this.burstSparksPool[index];
                const pulseTimer = this.getMaterialUniform(burstSparks?.material, 'uPulseTimer');
                const isIdleByTimer = pulseTimer === undefined || pulseTimer <= -50.0 || pulseTimer > 130.0;

                // Never rewind active waves; only trigger idle systems so bursts stack additively.
                if (isIdleByTimer) {
                    // Anchor each burst to the black-hole position at trigger time.
                    this.setMaterialUniformVec3(
                        burstSparks?.material,
                        'uBlackHolePos',
                        burstOrigin.x,
                        burstOrigin.y,
                        burstOrigin.z,
                    );
                    this.setMaterialUniform(burstSparks?.material, 'uPulseTimer', 0.0);
                    triggered += 1;
                }

                scanned += 1;
            }

            this.nextBurstIndex = (startIndex + scanned) % this.burstSparksPool.length;
            const shortfall = systemsToTrigger - triggered;
            if (shortfall > 0) {
                this.pendingBurstPoolTriggers += shortfall;
                this.pendingBurstPoolOrigin.copy(burstOrigin);
                console.log(
                    '[BlackHole] Burst pool saturated (queued, no reset):',
                    triggered,
                    '/',
                    systemsToTrigger,
                    'queued:',
                    this.pendingBurstPoolTriggers,
                );
            } else {
                console.log('[BlackHole] Triggered burst systems:', triggered);
            }
        } else {
            // Fallback for environments where dedicated burst systems are unavailable.
            this.spawnBurstParticles(comboCount);
        }

        console.log('[BlackHole] Burst triggered! Factor:', this.burstFactor);
    }

    getBurstSpawnCount(comboCount, totalParticles) {
        if (totalParticles <= 0) return 0;

        const multiplier = this.flags.useUnifiedParticles ? 90 : 60;
        const comboBudget = this.qualityPreset.comboParticleBudget ?? this.qualityPreset.particleCount;
        const maxByQuality = this.flags.useUnifiedParticles
            ? Math.max(320, Math.floor(comboBudget * 0.18))
            : Math.max(240, Math.floor(comboBudget * 0.14));
        const burstMax = Math.min(totalParticles, maxByQuality);

        return Math.min(comboCount * multiplier, burstMax);
    }

    getJetSpawnCount(comboCount, totalParticles) {
        if (totalParticles <= 0) return 0;

        const multiplier = this.flags.useUnifiedParticles ? 36 : 26;
        const comboBudget = this.qualityPreset.comboParticleBudget ?? this.qualityPreset.particleCount;
        const maxByQuality = this.flags.useUnifiedParticles
            ? Math.max(200, Math.floor(comboBudget * 0.07))
            : Math.max(140, Math.floor(comboBudget * 0.05));
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
     * Spawn particles from event-horizon shell during burst for explosive effect
     */
    spawnBurstParticles(comboCount) {
        if (!this.particles) return;

        if (this.isWebGPU && this.flags.useCompute && this.particleCompute?.computeNode) {
            const bhX = 0;
            const bhY = 0;
            const bhZ = 0;
            const burstLockSeconds = 16.0;
            const total = this.particles?.count ?? this.particleCompute.count;
            if (total <= 0) return;
            const burstCount = this.getBurstSpawnCount(comboCount, total);
            const indices = this.allocateComboParticleIndices(burstCount, 'nextBurstParticleIndex', burstLockSeconds);
            if (!indices.length) return;

            const burstCosT = this.diskCosTilt;
            const burstSinT = this.diskSinTilt;

            for (let i = 0; i < indices.length; i++) {
                const index = indices[i];
                const angle = this.random() * Math.PI * 2;
                const speed = 18 + this.random() * 28 + comboCount * 3;
                const shellRadius = 110 + this.random() * 30;
                // Spawn on event-horizon in the accretion disk plane
                const diskX = Math.cos(angle) * shellRadius;
                const diskZ = Math.sin(angle) * shellRadius;
                const diskH = (this.random() - 0.5) * 30;

                const x = bhX + diskX;
                const y = bhY + diskH * burstCosT - diskZ * burstSinT;
                const z = bhZ + diskH * burstSinT + diskZ * burstCosT;

                const vx = Math.cos(angle) * speed;
                const vy = -Math.sin(angle) * speed * burstSinT; // rotate velocity into disk plane
                const vz = Math.sin(angle) * speed * burstCosT;

                const colorChoice = this.random();
                let color;
                if (colorChoice < 0.3) {
                    color = this._burstColorWhite;
                } else if (colorChoice < 0.6) {
                    color = this._burstColorOrange;
                } else {
                    color = this._burstColorCyan;
                }

                const lockUntil = this.comboSpawnReuseUntil?.[index] || (this.time + burstLockSeconds);
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

        const bhX = 0;
        const bhY = 0;
        const bhZ = 0;
        const burstLockSeconds = 16.0;

        const total = this.particles?.geometry?.drawRange?.count ?? (positions.length / 3);
        if (total <= 0) return;
        const burstCount = this.getBurstSpawnCount(comboCount, total);
        const indices = this.allocateComboParticleIndices(burstCount, 'nextBurstParticleIndex', burstLockSeconds);
        if (!indices.length) return;

        const cpuBurstCosT = this.diskCosTilt;
        const cpuBurstSinT = this.diskSinTilt;

        for (let i = 0; i < indices.length; i++) {
            const index = indices[i];
            const i3 = index * 3;

            const angle = this.random() * Math.PI * 2;
            const shellRadius = 110 + this.random() * 30;
            // Spawn on event-horizon in the accretion disk plane
            const diskX = Math.cos(angle) * shellRadius;
            const diskZ = Math.sin(angle) * shellRadius;
            const diskH = (this.random() - 0.5) * 30;

            positions[i3] = bhX + diskX;
            positions[i3 + 1] = bhY + diskH * cpuBurstCosT - diskZ * cpuBurstSinT;
            positions[i3 + 2] = bhZ + diskH * cpuBurstSinT + diskZ * cpuBurstCosT;

            const speed = 18 + this.random() * 28 + comboCount * 3;

            velocities[i3] = Math.cos(angle) * speed;
            velocities[i3 + 1] = -Math.sin(angle) * speed * cpuBurstSinT;
            velocities[i3 + 2] = Math.sin(angle) * speed * cpuBurstCosT;

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
        // Particle positions are simulated in local space and offset in shader via uBlackHolePos.
        const bhX = 0;
        const bhY = 0;
        const bhZ = 0;
        const jetLockSeconds = 6.0;

        if (this.isWebGPU && this.flags.useCompute && this.particleCompute?.computeNode) {
            const total = this.particles?.count ?? this.particleCompute.count;
            if (total <= 0) return;
            const jetCount = this.getJetSpawnCount(comboCount, total);
            const indices = this.allocateComboParticleIndices(jetCount, 'nextJetParticleIndex', jetLockSeconds);
            if (!indices.length) return;

            for (let i = 0; i < indices.length; i++) {
                const index = indices[i];
                const direction = this.random() > 0.5 ? 1 : -1;
                const speed = 5 + this.random() * 10;

                // Spawn around local origin; material offset keeps jets on the black hole.
                const x = bhX + (this.random() - 0.5) * 20;
                const y = bhY + (this.random() - 0.5) * 20;
                const z = bhZ + (this.random() - 0.5) * 20;

                const vx = (this.random() - 0.5) * 2;
                const vy = direction * speed;
                const vz = (this.random() - 0.5) * 2;

                const color = direction > 0 ? this._jetColorBlue : this._jetColorRed;

                const lockUntil = this.comboSpawnReuseUntil?.[index] || (this.time + jetLockSeconds);
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

        const total = this.particles?.geometry?.drawRange?.count ?? (positions.length / 3);
        if (total <= 0) return;
        const jetCount = this.getJetSpawnCount(comboCount, total);
        const indices = this.allocateComboParticleIndices(jetCount, 'nextJetParticleIndex', jetLockSeconds);
        if (!indices.length) return;

        for (let i = 0; i < indices.length; i++) {
            const index = indices[i];
            const i3 = index * 3;

            // Spawn around local origin (world offset applied in shader)
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

        const swayScale = 0.38 + comboEnergy * 0.32;
        const swayX = (
            Math.sin(t * 0.22 + this.cameraPhaseX) * 8.5
            + Math.cos(t * 0.09 + this.cameraPhaseY) * 5.2
        ) * swayScale;
        const swayY = (
            Math.cos(t * 0.18 + this.cameraPhaseY) * 5.8
            + Math.sin(t * 0.11 + this.cameraPhaseZ) * 3.8
        ) * swayScale;
        const breatheZ = Math.sin(t * 0.14 + this.cameraPhaseZ) * (7 + comboEnergy * 5.5);

        const followX = this.driftX * 0.08;
        const followY = this.driftY * 0.06;
        const followZ = (this.driftZ || 0) * 0.15; // Camera slightly follows Z depth
        const surgePushIn = comboEnergy * 24;

        // Smooth pointer tracking for subtle mouse parallax
        this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, delta * 2.2);
        this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, delta * 2.2);
        const parallaxX = this.smoothedPointerX * 30.0;
        const parallaxY = -this.smoothedPointerY * 14.0;

        this.cameraTargetPosition.set(
            this.cameraBasePosition.x + followX + swayX + parallaxX,
            this.cameraBasePosition.y + followY + swayY + parallaxY,
            this.cameraBasePosition.z + followZ + breatheZ - surgePushIn,
        );

        const moveLerp = Math.min(1.0, delta * (1.8 + comboEnergy * 0.9));
        this.camera.position.lerp(this.cameraTargetPosition, moveLerp);

        const lookX = this.driftX * 0.3 + Math.sin(t * 0.2 + this.cameraPhaseX) * (2.6 + comboEnergy * 1.8) + parallaxX * 0.4;
        const lookY = this.driftY * 0.3 + Math.cos(t * 0.17 + this.cameraPhaseY) * (1.9 + comboEnergy * 1.5) + parallaxY * 0.4;
        const lookZ = this.driftZ * 0.3; // Look target slightly tracks depth

        this.cameraLookTarget.set(lookX, lookY, lookZ);
        const lookLerp = Math.min(1.0, delta * (2.4 + comboEnergy * 1.2));
        this.cameraLookTargetSmoothed.lerp(this.cameraLookTarget, lookLerp);
        this.camera.lookAt(this.cameraLookTargetSmoothed);

        // Subtle cinematic roll + focal breathing so the scene feels alive at idle.
        const rollTarget = (
            Math.sin(t * 0.08 + this.cameraPhaseY) * 0.0022
            + Math.cos(t * 0.13 + this.cameraPhaseZ) * 0.0016
        ) * (1.0 + comboEnergy * 0.3);
        const rollLerp = Math.min(1.0, delta * 2.0);
        this.cameraRoll += (rollTarget - this.cameraRoll) * rollLerp;
        this.cameraRollQuat.setFromAxisAngle(this.cameraRollAxis, this.cameraRoll);
        this.camera.quaternion.multiply(this.cameraRollQuat);

        const fovPulse = Math.sin(t * 0.11 + this.cameraPhaseX) * (0.14 + comboEnergy * 0.08);
        const targetFov = this.cameraBaseFov + fovPulse;
        const fovLerp = Math.min(1.0, delta * 1.8);
        this.camera.fov += (targetFov - this.camera.fov) * fovLerp;
        if (Math.abs(targetFov - this.camera.fov) > 0.001) {
            this.camera.updateProjectionMatrix();
        }
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
            if (this.particleEventBoost > 0) {
                this.particleEventBoost *= 0.88;
                if (this.particleEventBoost < 0.01) this.particleEventBoost = 0;
            }
            if (this.gravitySurgeFactor > 0) {
                this.gravitySurgeFactor *= 0.95; // Smooth decay
                if (this.gravitySurgeFactor < 0.01) this.gravitySurgeFactor = 0;
            }
            if (this.burstFactor > 0) {
                this.burstFactor *= this.qualityPreset.burstDecay ?? 0.94;
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

            this.setCachedUniform('hawkingTime', this.time);
            this.setCachedUniform('hawkingIntensity', this.hawkingIntensity);
            this.setCachedUniform('photonTime', this.time);
            this.setCachedUniform('photonIntensity', 0.9 + this.coreIntensity * 0.2 + this.photonSpherePulse);

            // Update burst sparks (fallback pool path only)
            if (!this.burstComputeBanks.length) {
                this.burstSparksPool.forEach((burstSparks) => {
                    const material = burstSparks?.material;
                    if (!material) return;

                    this.setMaterialUniform(material, 'uTime', this.time);

                    const pulseTimer = this.getMaterialUniform(material, 'uPulseTimer');
                    if (pulseTimer !== undefined && pulseTimer > -50.0) {
                        const nextPulse = pulseTimer + delta * 6.0;
                        this.setMaterialUniform(material, 'uPulseTimer', nextPulse > 130.0 ? -100.0 : nextPulse);
                    }
                });

                if (this.pendingBurstPoolTriggers > 0 && this.burstSparksPool.length > 0) {
                    let queuedTriggered = 0;
                    let scanned = 0;
                    const startIndex = this.nextBurstIndex;
                    const burstOrigin = this.pendingBurstPoolOrigin;

                    while (queuedTriggered < this.pendingBurstPoolTriggers && scanned < this.burstSparksPool.length) {
                        const index = (startIndex + scanned) % this.burstSparksPool.length;
                        const burstSparks = this.burstSparksPool[index];
                        const pulseTimer = this.getMaterialUniform(burstSparks?.material, 'uPulseTimer');
                        const isIdle = pulseTimer === undefined || pulseTimer <= -50.0 || pulseTimer > 130.0;

                        if (isIdle) {
                            this.setMaterialUniformVec3(
                                burstSparks?.material,
                                'uBlackHolePos',
                                burstOrigin.x,
                                burstOrigin.y,
                                burstOrigin.z,
                            );
                            this.setMaterialUniform(burstSparks?.material, 'uPulseTimer', 0.0);
                            queuedTriggered += 1;
                        }

                        scanned += 1;
                    }

                    if (queuedTriggered > 0) {
                        this.pendingBurstPoolTriggers = Math.max(0, this.pendingBurstPoolTriggers - queuedTriggered);
                        this.nextBurstIndex = (startIndex + scanned) % this.burstSparksPool.length;
                    }
                }
            }

            // Black hole floating/drifting motion
            const drift = this.computeDriftPosition(this.time);
            this.driftX = drift.x;
            this.driftY = drift.y;
            this.driftZ = drift.z;
            this.applyBlackHoleDriftState();
            if (this.burstRequestQueue.length > 0) {
                this.drainBurstRequestQueue();
            }

            if (this.starLensingCompute?.computeNode && this.renderer?.compute) {
                const lensingInterval = this.getLensingUpdateInterval();
                const runLensing = this.time >= this.performanceState.nextLensingComputeAt
                    || lensingInterval <= 0
                    || this.starFlashIntensity > 0.3
                    || this.burstFactor > 0.08;

                if (runLensing) {
                    const strengthBoost = Math.min(
                        0.45,
                        this.starFlashIntensity * 0.25
                        + this.gravitySurgeFactor * 0.03
                        + this.burstFactor * 0.02,
                    );
                    const lensingStrength = 0.38 + strengthBoost * 0.6;
                    this.starLensingCompute.update({
                        time: this.time,
                        blackHolePos: this.computeBlackHolePos.set(this.driftX || 0, this.driftY || 0, 0),
                        strength: lensingStrength,
                        activeCount: this.starfield?.count ?? this.starLensingCompute.count,
                    });
                    this.renderer.compute(this.starLensingCompute.computeNode);
                    this.performanceState.nextLensingComputeAt = this.time + lensingInterval;
                }
            }

            // Update burst sparks compute after drift update
            if (this.shouldRunBurstCompute()) {
                const blackHolePos = this.computeBlackHolePos.set(this.driftX || 0, this.driftY || 0, this.driftZ || 0);
                for (let i = 0; i < this.burstComputeBanks.length; i += 1) {
                    const burstCompute = this.burstComputeBanks[i];
                    if (!burstCompute?.computeNode) continue;
                    if (!burstCompute.hasActiveParticles?.(this.time)) continue;
                    burstCompute.update(delta, {
                        time: this.time,
                        blackHolePos,
                        burstFactor: this.burstFactor,
                    });
                    if (this.renderer?.compute) {
                        this.renderer.compute(burstCompute.computeNode);
                    }
                }
            }

            // Update particles
            this.updateParticles(delta);
            this.setMaterialUniform(this.particles?.material, 'uEventBoost', 1.0 + this.particleEventBoost);
            const hawkingInterval = this.getHawkingUpdateInterval();
            if (hawkingInterval > 0) {
                this.performanceState.hawkingUpdateAccumulator += delta;
                if (this.performanceState.hawkingUpdateAccumulator >= hawkingInterval) {
                    this.updateHawkingRadiation(Math.min(0.09, this.performanceState.hawkingUpdateAccumulator));
                    this.performanceState.hawkingUpdateAccumulator = 0;
                }
            } else {
                const hawkingDelta = this.performanceState.hawkingUpdateAccumulator > 0
                    ? Math.min(0.09, this.performanceState.hawkingUpdateAccumulator + delta)
                    : delta;
                this.performanceState.hawkingUpdateAccumulator = 0;
                this.updateHawkingRadiation(hawkingDelta);
            }

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
                this.chromaticPass.uniforms.amount.value = Math.max(0.0006, this.chromaticPulse);
            }
            if (this.postProcessing) {
                this.postProcessing.update({
                    bloomStrength: this.qualityPreset.bloomStrength * (1 + this.bloomPulseIntensity),
                    bloomRadius: this.qualityPreset.bloomRadius,
                    chromaticStrength: this.flags.useChromatic ? Math.max(0.0006, this.chromaticPulse) : 0.0,
                    bloomDownsample: this.getAdaptiveBloomDownsample(),
                    ditherStrength: 0.0,
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
            const computeInterval = this.getParticleComputeInterval();
            let computeDelta = delta;
            if (computeInterval > 0) {
                this.performanceState.particleComputeAccumulator += delta;
                if (this.performanceState.particleComputeAccumulator < computeInterval) {
                    return;
                }
                computeDelta = Math.min(0.075, this.performanceState.particleComputeAccumulator);
                this.performanceState.particleComputeAccumulator = 0;
            } else if (this.performanceState.particleComputeAccumulator > 0) {
                computeDelta = Math.min(0.075, this.performanceState.particleComputeAccumulator + delta);
                this.performanceState.particleComputeAccumulator = 0;
            }

            const bhX = 0;
            const bhY = 0;
            const bhZ = 0;

            this.computeBlackHolePos.set(bhX, bhY, bhZ);
            this.particleCompute.update(computeDelta, {
                time: this.time,
                blackHolePos: this.computeBlackHolePos,
                gravitySurge: this.gravitySurgeFactor,
                burstFactor: this.burstFactor,
                burstPhase: this.burstPhase,
                comboScatterUntil: this.comboScatterHoldUntil,
                activeCount: this.particles?.count ?? this.particleCompute.count,
            });
            this.renderer.compute(this.particleCompute.computeNode);
            return;
        }

        if (!this.particleAttributes) return;

        const positions = this.particleAttributes.position.array;
        const velocities = this.particleVelocities;
        const lifetimes = this.particleLifetimes;

        const bhX = 0;
        const bhY = 0;
        const bhZ = 0;
        const comboScatterWindowActive = this.time <= this.comboScatterHoldUntil;
        const normalX = 0;
        const normalY = this.diskCosTilt;
        const normalZ = this.diskSinTilt;
        const planePullScale = delta * 60.0;
        const planeDamp = Math.min(0.35, delta * 5.0);

        const activeCount = Math.min(
            lifetimes.length,
            this.particles?.geometry?.drawRange?.count ?? lifetimes.length,
        );

        for (let i = 0; i < activeCount; i += 1) {
            const i3 = i * 3;
            const comboLockUntil = this.comboSpawnReuseUntil?.[i] || 0;
            const comboLocked = comboLockUntil > this.time;
            const comboScatterActive = comboLocked && comboScatterWindowActive;
            const shouldBurst = comboLocked && ((this.burstPhase && this.burstFactor > 0) || comboScatterActive);
            const effectiveBurstFactor = comboScatterActive ? Math.max(this.burstFactor, 1.5) : this.burstFactor;
            const burstBlend = Math.min(1.0, effectiveBurstFactor / 8.0);

            // Calculate positions from center (bh is 0,0,0)
            const px = positions[i3];
            const py = positions[i3 + 1];
            const pz = positions[i3 + 2];
            const distSq = px * px + py * py + pz * pz;

            if (distSq > 2500) { // 50*50
                const dist = Math.sqrt(distSq);
                // BURST PHASE: Push particles outward
                if (shouldBurst) {
                    // Normalize direction from black hole center
                    const nx = px / dist;
                    const ny = py / dist;
                    const nz = pz / dist;

                    // Outward force - stronger when closer to center, scaled by burstFactor
                    const burstStrength = effectiveBurstFactor * (400.0 / (dist + 50)) * delta;

                    velocities[i3] += nx * burstStrength;
                    velocities[i3 + 1] += ny * burstStrength;
                    velocities[i3 + 2] += nz * burstStrength;

                    // Less drag during burst to let particles fly out
                    velocities[i3] *= 0.998;
                    velocities[i3 + 1] *= 0.998;
                    velocities[i3 + 2] *= 0.998;

                    // Higher max speed during burst
                    const maxSpeed = 15.0 + effectiveBurstFactor * 3.0;
                    const maxSpeedSq = maxSpeed * maxSpeed;
                    const speedSq = velocities[i3] * velocities[i3]
                        + velocities[i3 + 1] * velocities[i3 + 1]
                        + velocities[i3 + 2] * velocities[i3 + 2];
                    if (speedSq > maxSpeedSq) {
                        const scale = maxSpeed / Math.sqrt(speedSq);
                        velocities[i3] *= scale;
                        velocities[i3 + 1] *= scale;
                        velocities[i3 + 2] *= scale;
                    }
                } else {
                    // NORMAL/SUCTION PHASE: Pull particles inward

                    // Gravity pull - increases closer to center
                    // Reduced from 1200 to 800 for even slower "floating" feel
                    let pullStrength = (800.0 / (distSq + 100)) * delta;
                    if (comboLocked) {
                        // Preserve combo burst trails so they accumulate across close combos.
                        pullStrength *= 0.08;
                    }

                    // STRONG suction during combos
                    if (this.gravitySurgeFactor > 0) {
                        pullStrength *= (5.0 + this.gravitySurgeFactor * 2.0);
                    }

                    velocities[i3] -= px * pullStrength;
                    velocities[i3 + 1] -= py * pullStrength;
                    velocities[i3 + 2] -= pz * pullStrength;

                    // Tangential acceleration REMOVED - rely on natural gravity + drag for organic spiral
                    // This prevents the "off" feeling of forced planar motion

                    // Combined damping (0.995 * 0.99 = 0.98505) - one multiply per axis instead of two.
                    velocities[i3] *= 0.98505;
                    velocities[i3 + 1] *= 0.98505;
                    velocities[i3 + 2] *= 0.98505;

                    // Limit max speed so they don't teleport
                    const maxSpeed = 8.0 + this.gravitySurgeFactor * 5.0; // Allow faster speed during surge
                    const maxSpeedSq = maxSpeed * maxSpeed;
                    const speedSq = velocities[i3] * velocities[i3]
                        + velocities[i3 + 1] * velocities[i3 + 1]
                        + velocities[i3 + 2] * velocities[i3 + 2];
                    if (speedSq > maxSpeedSq) {
                        const scale = maxSpeed / Math.sqrt(speedSq);
                        velocities[i3] *= scale;
                        velocities[i3 + 1] *= scale;
                        velocities[i3 + 2] *= scale;
                    }
                }
            }

            // plane calculation (normalX = 0)
            const planeOffset = py * normalY + pz * normalZ;
            const radialX = px;
            const radialY = py - normalY * planeOffset;
            const radialZ = pz - normalZ * planeOffset;
            const radialDistSq = radialX * radialX + radialY * radialY + radialZ * radialZ;

            // Skip the orbital assist when the particle is far outside the disk - innerBias saturates
            // to 0 beyond ~750 units so the contribution is negligible, and we save a sqrt + normalize.
            if (radialDistSq < 562500) { // 750 * 750
                const tangentY = normalZ * radialX;
                const tangentZ = -normalY * radialX;
                const tangentX = normalY * radialZ - normalZ * radialY;
                const tangentLenSq = tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ;

                if (tangentLenSq > 1e-8) {
                    const tangentInv = 1 / Math.sqrt(tangentLenSq);
                    const tX = tangentX * tangentInv;
                    const tY = tangentY * tangentInv;
                    const tZ = tangentZ * tangentInv;
                    const radialDist = Math.sqrt(radialDistSq);
                    const radialNorm = Math.max(0, Math.min(1, (radialDist - 220) / (750 - 220)));
                    const innerBias = 1 - radialNorm;
                    const orbitalAssist = 0.0009 + innerBias * 0.0015;
                    velocities[i3] += tX * orbitalAssist;
                    velocities[i3 + 1] += tY * orbitalAssist;
                    velocities[i3 + 2] += tZ * orbitalAssist;
                }
            }

            const clampedPlaneOffset = Math.max(-0.32, Math.min(0.32, planeOffset * 0.0035));
            const planePull = clampedPlaneOffset * planePullScale;
            velocities[i3 + 1] -= normalY * planePull;
            velocities[i3 + 2] -= normalZ * planePull;

            const normalVelocity = velocities[i3 + 1] * normalY + velocities[i3 + 2] * normalZ;
            velocities[i3 + 1] -= normalY * normalVelocity * planeDamp;
            velocities[i3 + 2] -= normalZ * normalVelocity * planeDamp;

            // Update position
            positions[i3] += velocities[i3];
            positions[i3 + 1] += velocities[i3 + 1];
            positions[i3 + 2] += velocities[i3 + 2];

            // Smoothly relax reset distance during bursts so chained combos don't pop particles back.
            const maxDist = comboScatterActive ? (4200 + burstBlend * 800) : (950 + burstBlend * 750);
            const minResetDist = comboScatterActive ? 30 : 80;
            const nextDistSq = positions[i3] * positions[i3] + positions[i3 + 1] * positions[i3 + 1] + positions[i3 + 2] * positions[i3 + 2];
            const minSq = minResetDist * minResetDist;
            const maxSq = maxDist * maxDist;
            if (!comboLocked && (nextDistSq < minSq || nextDistSq > maxSq)) {
                this.initParticle(
                    i,
                    positions,
                    velocities,
                    this.particleAttributes.color.array,
                    this.particleAttributes.size.array,
                    lifetimes,
                    this.particleColors,
                    0,
                    0,
                    0,
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

        if (!this.isWebGPU && this.particles?.material) {
            this.setMaterialUniformVec3(this.particles.material, 'uBlackHolePos', this.driftX || 0, this.driftY || 0, this.driftZ || 0);
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
        if (this.hiddenLegacyGlobals.length) {
            this.hiddenLegacyGlobals.forEach(({ el, style }) => {
                if (!el) return;
                if (style === null || style === undefined || style === '') {
                    el.removeAttribute('style');
                } else {
                    el.setAttribute('style', style);
                }
            });
            this.hiddenLegacyGlobals = [];
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
            this.disposeRenderer(this.renderer, { nullInstance: false });
        }

        this.bloomPass?.dispose?.();
        this.chromaticPass?.dispose?.();
        if (this.postProcessing) {
            this.postProcessing.dispose();
            this.postProcessing = null;
        }
        if (this.composer) {
            this.disposeComposer(this.composer);
        }
        if (this.particleCompute) {
            this.particleCompute.dispose();
            this.particleCompute = null;
        }
        this.disposeBurstComputeBanks();
        if (this.starLensingCompute) {
            this.starLensingCompute.dispose();
            this.starLensingCompute = null;
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.bloomPass = null;
        this.chromaticPass = null;
        this.particleAttributes = null;
        this.comboSpawnReuseUntil = null;
        this.comboBurstAnchorUntil = 0;
        this.comboScatterHoldUntil = 0;
        this.comboBurstAnchor.set(0, 0, 0);
        this.pendingBurstPoolOrigin.set(0, 0, 0);
        this.isWebGPU = false;
        this.blackHoleCore = null;
        this.accretionDisk = null;
        this.accretionVolumeLayers = [];
        this.starfield = null;
        this.particles = null;
        this.hawkingParticles = null;
        this.photonSphere = null;
        this.burstSparks = null;
        this.burstSparkBanks = [];
        this.burstComputeBanks = [];
        this.burstCapacityBase = 0;
        this.burstCapacityMax = 0;
        this.burstRequestQueue = [];
        this.nextBurstBankIndex = 0;
        this.burstSparksPool = [];
        this.nextBurstIndex = 0;
        this.pendingBurstPoolTriggers = 0;
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
