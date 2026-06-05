/* eslint-disable import/no-unresolved */
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ELECTRIC DREAMS THEME - AAA Lava Lamp Experience
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Premium lava lamp with floating, morphing neon blobs.
 * WebGPU path: TSL node materials, GPU compute particles, MRT selective bloom,
 *   chromatic aberration, vignette, god rays, ACES tone mapping, color grading.
 * WebGL fallback: original ShaderMaterial + EffectComposer path.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { mrt, vec3 } from 'three/tsl';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { ELECTRIC_DREAMS_TETROMINOS } from './electric-dreams-tetrominos.js';
import {
    BoardHaloController,
    ParticleOrchestrator,
    StageConductor,
} from './electric-dreams-stage-systems.js';
import * as ElectricDreamsMaterials from './electric-dreams-materials.js';
import * as ElectricDreamsPostModule from './electric-dreams-post.js';
import * as ElectricDreamsHeroParticlesModule from './electric-dreams-hero-particles.js';
import * as ElectricDreamsComputeModule from './electric-dreams-compute.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        blobCount: 16,
        particleCount: 1100,
        boardHaloEmberCount: 400,
        microGlintCount: 200,
        tierCounts: { hero: 2, support: 6, ghost: 8 },
        bloomStrength: 0.54,
        enablePost: true,
        blobDetail: 4,
        // useInterior dropped — it duplicates the main mesh's emissive shading.
        // Selective bloom (MRT) does this job for free from the main emissive output.
        useInterior: false,
        useGlow: true,
        // Glass overlay now handled in post (uGlassRimStrength in post profile) — no
        // world-space sphere needed. Saves 60-tri sphere + full-screen overdraw pass.
        useGlassOverlay: false,
        // MRT enabled so bloom only processes the emissive channel — gives the
        // vibrant halo without bloom blowing out non-emissive surfaces.
        enableMRT: true,
        // GPU compute enabled — moves 1100 spark particle updates off the CPU.
        // If unavailable (no WebGPU compute support), _safeCompute auto-disables it.
        enableCompute: true,
    },
    Ultra: {
        blobCount: 14,
        particleCount: 850,
        boardHaloEmberCount: 320,
        microGlintCount: 130,
        tierCounts: { hero: 2, support: 5, ghost: 7 },
        bloomStrength: 0.46,
        enablePost: true,
        blobDetail: 3,
        useInterior: false,
        useGlow: true,
        // Glass overlay now handled in post (uGlassRimStrength in post profile) — no
        // world-space sphere needed. Saves 60-tri sphere + full-screen overdraw pass.
        useGlassOverlay: false,
        enableMRT: true,
        enableCompute: true,
    },
    High: {
        blobCount: 12,
        particleCount: 600,
        boardHaloEmberCount: 220,
        microGlintCount: 56,
        tierCounts: { hero: 2, support: 4, ghost: 6 },
        bloomStrength: 0.38,
        enablePost: true,
        blobDetail: 3,
        useInterior: false,
        // Glow off at High — bloom (now selective via MRT) creates the halo for free.
        useGlow: false,
        useGlassOverlay: false,
        enableMRT: true,
        enableCompute: true,
    },
    Medium: {
        blobCount: 8,
        particleCount: 360,
        boardHaloEmberCount: 140,
        microGlintCount: 0,
        tierCounts: { hero: 1, support: 3, ghost: 4 },
        bloomStrength: 0.3,
        enablePost: true,
        blobDetail: 2,
        useInterior: false,
        useGlow: false,
        useGlassOverlay: false,
        enableMRT: true,
        enableCompute: false,
    },
    Low: {
        blobCount: 5,
        particleCount: 180,
        boardHaloEmberCount: 24,
        microGlintCount: 0,
        tierCounts: { hero: 1, support: 2, ghost: 2 },
        bloomStrength: 0.16,
        enablePost: false,
        blobDetail: 2,
        useInterior: false,
        useGlow: false,
        useGlassOverlay: false,
        enableMRT: false,
        enableCompute: false,
    },
    Minimal: {
        blobCount: 3,
        particleCount: 100,
        boardHaloEmberCount: 0,
        microGlintCount: 0,
        tierCounts: { hero: 1, support: 1, ghost: 1 },
        bloomStrength: 0.12,
        enablePost: false,
        blobDetail: 1,
        useInterior: false,
        useGlow: false,
        useGlassOverlay: false,
        enableMRT: false,
        enableCompute: false,
    },
};

const ADAPTIVE_BUDGET = Object.freeze({
    dynamicResolutionEnabled: true,
    // Target 13.5ms (≈74 FPS) so adaptive scaling kicks in BEFORE we miss 60 FPS,
    // giving us headroom instead of reacting after the user already feels lag.
    targetFrameMs: 13.5,
    adaptiveMinScale: 0.65,
    adaptiveMaxScale: 1.0,
    // Faster downscale so spikes recover quickly; slower upscale so we don't oscillate.
    adaptiveDownRate: 0.08,
    adaptiveUpRate: 0.015,
    minResolutionScale: 0.60,
    maxResolutionScale: 1.0,
    postDisableScale: 0.72,
    postEnableScale: 0.82,
    // Re-evaluate 2.5× more often so we react to sustained pressure within ~200ms.
    applyIntervalMs: 200,
    postToggleCooldownMs: 1500,
});

const PERF_HISTORY_SIZE = 120;
const PERF_WARMUP_FRAMES = 120;
const PERF_METRIC_KEYS = Object.freeze([
    'frameMs',
    'blobUpdateMs',
    'sparkUpdateMs',
    'computeMs',
    'postMs',
    'renderMs',
]);

const BLOB_LAYER_SCALES = Object.freeze({
    interior: 0.85,
    main: 1.0,
    glow: 1.5,
});

const BURST_BLOB_CONFIG = Object.freeze({
    maxActive: 28,
    baseLife: 0.62,
    maxLifeJitter: 0.28,
    minScaleFactor: 0.12,
    maxScaleFactor: 0.28,
    towardCameraSpeed: 14,
    radialSpeed: 8.4,
    jitterSpeed: 4.4,
    zAcceleration: 12,
    drag: 0.935,
});

const GAMEPLAY_SPARK_CONFIG = Object.freeze({
    poolSize: 10,
    // Per-burst counts reduced ~30-40%. With selective bloom (#2) operating on
    // the emissive channel, 200 sparks reads visually identical to 400 — the
    // bloom smears the brightness blob the same way. The CPU init cost scales
    // linearly with count, so this directly trims combo-event frame spikes.
    maxParticlesPerBurst: 320,
    lockMin: 28,
    lockMax: 42,
    lineSingleMin: 60,
    lineSingleMax: 90,
    lineMultiMin: 100,
    lineMultiMax: 150,
    tetrisMin: 200,
    tetrisMax: 280,
    comboChargeMin: 54,
    comboChargeMax: 88,
    comboRuptureMin: 120,
    comboRuptureMax: 180,
    comboSurgeMin: 220,
    comboSurgeMax: 320,
    drag: 0.925,
    zAcceleration: 9.4,
    // Per-frame cap: at most this many NEW bursts can be initialized in one
    // animation frame. Excess go to _burstQueue and drain at 1/frame, spreading
    // the geometry-upload spikes across multiple frames.
    maxNewBurstsPerFrame: 1,
});

const LINE_WAKE_CONFIG = Object.freeze({
    poolSize: 12,
    baseLife: 0.56,
    tetrisLife: 0.88,
    baseOpacity: 0.24,
});

const MICRO_GLINT_CONFIG = Object.freeze({
    sizeMin: 0.35,
    sizeMax: 1.1,
});

const AMBIENT_PARTICLE_MODES = Object.freeze({
    ambient: 0,
    surface: 1,
    bridge: 2,
    hero: 3,
});

const BLOB_STAGE_LAYOUTS = Object.freeze({
    hero: Object.freeze([
        Object.freeze({
            x: -0.18, y: 0.04, z: -4.2, scaleMin: 7.2, scaleMax: 8.4, drift: 0.58, heatScale: 1.14, invasionX: -0.05, invasionY: -0.01, invasionZ: 2.8,
        }),
        Object.freeze({
            x: 0.2, y: -0.05, z: -3.6, scaleMin: 7.0, scaleMax: 8.3, drift: 0.6, heatScale: 1.14, invasionX: 0.05, invasionY: -0.03, invasionZ: 3.0,
        }),
    ]),
    support: Object.freeze([
        Object.freeze({
            x: -0.74, y: 0.24, z: -8.8, scaleMin: 5.0, scaleMax: 6.2, drift: 0.58, heatScale: 1.1, invasionX: 0.08, invasionY: -0.03, invasionZ: 2.1,
        }),
        Object.freeze({
            x: 0.76, y: -0.12, z: -8.4, scaleMin: 5.0, scaleMax: 6.3, drift: 0.58, heatScale: 1.1, invasionX: -0.08, invasionY: 0.03, invasionZ: 2.0,
        }),
        Object.freeze({
            x: -0.56, y: -0.42, z: -11.4, scaleMin: 4.5, scaleMax: 5.6, drift: 0.52, heatScale: 1.08, invasionX: 0.06, invasionY: 0.07, invasionZ: 1.8,
        }),
        Object.freeze({
            x: 0.58, y: 0.42, z: -10.8, scaleMin: 4.4, scaleMax: 5.5, drift: 0.52, heatScale: 1.08, invasionX: -0.05, invasionY: -0.06, invasionZ: 1.8,
        }),
        Object.freeze({
            x: 0.04, y: 0.62, z: -13.8, scaleMin: 3.8, scaleMax: 5.0, drift: 0.48, heatScale: 1.06, invasionX: 0.0, invasionY: -0.1, invasionZ: 1.5,
        }),
        Object.freeze({
            x: -0.04, y: -0.66, z: -14.4, scaleMin: 3.8, scaleMax: 5.0, drift: 0.48, heatScale: 1.06, invasionX: 0.0, invasionY: 0.09, invasionZ: 1.5,
        }),
    ]),
    ghost: Object.freeze([
        Object.freeze({
            x: -0.82, y: 0.54, z: -18.8, scaleMin: 2.7, scaleMax: 3.7, drift: 0.28, heatScale: 1.04, invasionX: 0.06, invasionY: -0.04, invasionZ: 0.9,
        }),
        Object.freeze({
            x: 0.84, y: -0.48, z: -19.8, scaleMin: 2.7, scaleMax: 3.7, drift: 0.28, heatScale: 1.04, invasionX: -0.06, invasionY: 0.04, invasionZ: 0.9,
        }),
        Object.freeze({
            x: -0.36, y: 0.76, z: -21.4, scaleMin: 2.7, scaleMax: 3.8, drift: 0.25, heatScale: 1.03, invasionX: 0.04, invasionY: -0.06, invasionZ: 0.8,
        }),
        Object.freeze({
            x: 0.42, y: -0.8, z: -22.0, scaleMin: 2.7, scaleMax: 3.9, drift: 0.25, heatScale: 1.03, invasionX: -0.04, invasionY: 0.08, invasionZ: 0.8,
        }),
        Object.freeze({
            x: -0.14, y: -0.92, z: -23.4, scaleMin: 2.5, scaleMax: 3.6, drift: 0.22, heatScale: 1.02, invasionX: 0.02, invasionY: 0.05, invasionZ: 0.7,
        }),
        Object.freeze({
            x: 0.16, y: 0.88, z: -24.2, scaleMin: 2.5, scaleMax: 3.6, drift: 0.22, heatScale: 1.02, invasionX: -0.02, invasionY: -0.05, invasionZ: 0.7,
        }),
        Object.freeze({
            x: -0.7, y: -0.08, z: -25.2, scaleMin: 2.4, scaleMax: 3.5, drift: 0.2, heatScale: 1.02, invasionX: 0.04, invasionY: 0.0, invasionZ: 0.6,
        }),
        Object.freeze({
            x: 0.72, y: 0.1, z: -25.8, scaleMin: 2.4, scaleMax: 3.5, drift: 0.2, heatScale: 1.02, invasionX: -0.04, invasionY: 0.0, invasionZ: 0.6,
        }),
    ]),
});

const BLOB_MOTION_PROFILES = Object.freeze({
    hero: Object.freeze({
        xyDriftMult: 1.55,
        zDriftMult: 2.1,
        baseSpeed: 0.62,
        breathMin: 0.92,
        breathMax: 1.18,
        finalMin: 0.88,
        finalMax: 1.24,
        anchorStiffness: 0.012,
        positionalDamping: 0.936,
        scaleDamping: 0.89,
        presenceScale: 0.16,
        depthTravel: 3.2,
        approachPull: 0.011,
        contactRepel: 0.018,
        scaleShare: 0.26,
        frontClamp: 8.8,
        backClamp: -24.5,
        idleWindowStrength: 0.28,
        settleStrength: 0.06,
        rotationBase: 0.42,
        rotationResponse: 0.00012,
        morphCeiling: 1.1,
    }),
    support: Object.freeze({
        xyDriftMult: 1.34,
        zDriftMult: 1.8,
        baseSpeed: 0.74,
        breathMin: 0.9,
        breathMax: 1.14,
        finalMin: 0.86,
        finalMax: 1.2,
        anchorStiffness: 0.011,
        positionalDamping: 0.928,
        scaleDamping: 0.86,
        presenceScale: 0.12,
        depthTravel: 2.4,
        approachPull: 0.01,
        contactRepel: 0.017,
        scaleShare: 0.22,
        frontClamp: 2.4,
        backClamp: -27.5,
        idleWindowStrength: 0.38,
        settleStrength: 0.074,
        rotationBase: 0.34,
        rotationResponse: 0.0001,
        morphCeiling: 0.94,
    }),
    ghost: Object.freeze({
        xyDriftMult: 0.98,
        zDriftMult: 1.28,
        baseSpeed: 0.58,
        breathMin: 0.94,
        breathMax: 1.08,
        finalMin: 0.9,
        finalMax: 1.12,
        anchorStiffness: 0.008,
        positionalDamping: 0.944,
        scaleDamping: 0.88,
        presenceScale: 0.08,
        depthTravel: 1.6,
        approachPull: 0.006,
        contactRepel: 0.014,
        scaleShare: 0.16,
        frontClamp: -0.4,
        backClamp: -30.5,
        idleWindowStrength: 0.52,
        settleStrength: 0.082,
        rotationBase: 0.22,
        rotationResponse: 0.00006,
        morphCeiling: 0.72,
    }),
});

const STAGE_HEAT_DECAY = 0.5 ** (1 / 360);

const FX_DECAY = Object.freeze({
    lockImpact: 0.82,
    lineSurge: 0.86,
    comboCharge: 0.965,
    comboPeak: 0.91,
    surgeState: 0.93,
    stageHeat: STAGE_HEAT_DECAY,
    bloomBoost: 0.84,
    chromaPulse: 0.83,
    vignettePulse: 0.87,
    shockwaveStrength: 0.80,
    exposureDip: 0.9,
    dangerLevel: 0.94,
    rewardPulse: 0.89,
    overdrivePulse: 0.92,
});

function createFxState() {
    return {
        impactOrigin: new THREE.Vector3(),
        impactDirection: new THREE.Vector3(0, 1, 0),
        impactScreen: new THREE.Vector2(0.5, 0.5),
        hasImpactOrigin: false,
        lockImpact: 0,
        lineSurge: 0,
        comboCharge: 0,
        comboPeak: 0,
        surgeState: 0,
        stageHeat: 0,
        stageState: 'calm',
        actIndex: 1,
        actProgress: 0,
        beatPulse: 0,
        barPhase: 0,
        phrasePhase: 0,
        boardHaloEnergy: 0,
        fieldTakeover: 0,
        heroWindow: 0,
        dominantAccent: new THREE.Color(0x00ffcc),
        supportAccent: new THREE.Color(0xff00ff),
        bloomBoost: 0,
        chromaPulse: 0,
        vignettePulse: 0,
        shockwaveStrength: 0,
        exposureDip: 0,
        dangerLevel: 0,
        rewardPulse: 0,
        overdrivePulse: 0,
        lineBandY: 0,
        lineBandHeight: 0.18,
        lastComboCount: 0,
        lastLineCount: 0,
    };
}

function createMetricBucket() {
    return { ema: 0, samples: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Color Palette - Premium Lava Lamp Colors
// ─────────────────────────────────────────────────────────────────────────────
const BLOB_COLORS = [
    new THREE.Color(0x4de8c2), // Soft Teal
    new THREE.Color(0xd46af0), // Orchid Purple
    new THREE.Color(0x56e89a), // Mint Green
    new THREE.Color(0xf09848), // Warm Amber
    new THREE.Color(0x5c9cf5), // Periwinkle Blue
    new THREE.Color(0xf0c850), // Soft Gold
    new THREE.Color(0xf04878), // Rose Pink
    new THREE.Color(0x9c5cf5), // Lavender
];

// ─────────────────────────────────────────────────────────────────────────────
// WebGL Fallback Shaders (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────
const BlobShader = {
    uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x00ffcc) },
        uPulseIntensity: { value: 0 },
        uMorphFactor: { value: 0 },
    },
    vertexShader: `
        uniform float uTime;
        uniform float uMorphFactor;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vNoise;
        float hash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                    mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                    mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
            float value = 0.0;
            float amplitude = 0.5;
            float frequency = 1.0;
            for (int i = 0; i < 4; i++) {
                value += amplitude * noise(p * frequency);
                amplitude *= 0.5;
                frequency *= 2.0;
            }
            return value;
        }
        void main() {
            vec3 pos = position;
            float slowTime = uTime * 0.15;
            float n1 = fbm(pos * 0.8 + slowTime * 0.3);
            float n2 = noise(pos * 2.0 + slowTime * 0.5) * 0.5;
            float n3 = noise(pos * 4.0 - slowTime * 0.2) * 0.25;
            float totalNoise = n1 + n2 + n3;
            float displacement = totalNoise * 0.25 * (0.5 + uMorphFactor * 1.5);
            float breathe = sin(uTime * 0.4) * 0.04 + sin(uTime * 0.23) * 0.02;
            pos += normal * (displacement + breathe);
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPosition = worldPos.xyz;
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            vNoise = totalNoise;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uPulseIntensity;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vNoise;
        void main() {
            float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
            float sss = pow(rim, 2.2);
            float coreGlow = 0.28 + 0.12 * (1.0 - rim);
            float pulse = 1.0 + sin(uTime * 1.5) * 0.05 * (1.0 + uPulseIntensity * 0.3);
            float internalLight = 0.36 + vNoise * 0.12;
            float fresnel = pow(rim, 2.8);
            vec3 baseColor = uColor * internalLight * pulse * 0.72;
            vec3 rimColor = uColor * fresnel * 0.16;
            vec3 sssColor = uColor * sss * 0.08;
            vec3 finalColor = baseColor * coreGlow + rimColor + sssColor;
            finalColor *= (0.82 + uPulseIntensity * 0.06);
            gl_FragColor = vec4(finalColor, 0.78);
        }
    `,
};

const SparkShader = {
    uniforms: {
        uTime: { value: 0 },
        uComboIntensity: { value: 0 },
        uComboSpeedBoost: { value: 1 },
        uComboSizeBoost: { value: 1 },
    },
    vertexShader: `
        attribute float size;
        attribute float phase;
        attribute vec3 color;
        uniform float uTime;
        uniform float uComboIntensity;
        uniform float uComboSpeedBoost;
        uniform float uComboSizeBoost;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vComboGlow;
        void main() {
            vColor = color;
            vComboGlow = uComboIntensity;
            vec3 pos = position;
            float speed = 0.18 * uComboSpeedBoost;
            float t = mod(uTime * speed + phase, 1.0);
            float moveMult = 1.0 + uComboIntensity * 0.35;
            pos.x += sin(uTime * 0.42 * uComboSpeedBoost + phase * 10.0) * 0.75 * moveMult;
            pos.y += cos(uTime * 0.28 * uComboSpeedBoost + phase * 14.0) * 0.48 * moveMult;
            pos.z += sin(uTime * 0.31 * uComboSpeedBoost + phase * 8.0) * 0.34 * moveMult;
            vAlpha = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.75, t);
            vAlpha *= (1.0 + uComboIntensity * 0.5);
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            float comboSize = size * uComboSizeBoost;
            gl_PointSize = comboSize * (400.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vComboGlow;
        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            float dist = length(coord);
            if (dist > 0.5) discard;
            float glow = 1.0 - smoothstep(0.0, 0.5, dist);
            glow = pow(glow, 2.0 - vComboGlow * 0.3);
            vec3 finalColor = mix(vColor, vec3(1.0), vComboGlow * 0.2);
            float brightness = 1.2 + vComboGlow * 0.6;
            gl_FragColor = vec4(finalColor * glow * brightness, vAlpha * glow);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class ElectricDreamsTheme extends BaseTheme {
    constructor() {
        super('electric-dreams');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();
        this.time = 0;

        this.blobs = [];
        this.burstBlobs = [];
        this.sparks = null;
        this.backgroundMesh = null;
        this.boardHaloMesh = null;
        this.boardHaloEmbers = null;
        this.glassMesh = null;
        this.coreLight = null;
        this.screenBounds = { width: 30, height: 20 };

        this.pulseIntensity = 0;
        this.targetPulse = 0;
        this.glowFlash = 0;
        this.targetBloom = 0.6;
        this.baseBloomStrength = 0.6;

        this.comboIntensity = 0;
        this.comboColorFlash = 0;
        this.comboScaleBoost = 0;
        this.comboSpeedBoost = 0;
        this.activeQualityLevel = 'High';

        // WebGPU state
        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
        };
        this.flags = {
            usePost: false,
            useMRT: false,
            useCompute: false,
            forceWebGL: false,
            noPost: false,
            noMRT: false,
            noCompute: false,
        };

        // WebGPU modules (lazy loaded)
        this.postPipeline = null;
        this.sparkCompute = null;
        this.webgpuMaterials = null;
        this.sparkUniforms = null;
        this.backgroundUniforms = null;
        this.boardHaloUniforms = null;
        this.glassUniforms = null;
        this.bloomPass = null;
        this.boundResizeHandler = null;
        this.postFallbackPending = false;
        this.computeFallbackPending = false;
        this.hasRetriedPostWithoutMrt = false;
        this.geometryCache = new Map();

        this.postProfile = null;
        this.adaptiveBudgetState = null;
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedResolutionScale = 1;
        this.lastAdaptiveApplyTime = 0;
        this.lastPostToggleTime = 0;
        this.postSuppressedByBudget = false;
        this.lastAdaptivePostParams = null;

        this.performanceTelemetry = null;
        this.pendingBurstRequest = null;
        this.fxState = createFxState();
        this.blobTierCounts = {
            hero: 0,
            support: 0,
            ghost: 0,
        };
        this.gameplaySparkBursts = [];
        this.lineWakes = [];
        this.ambientSparkState = null;
        this.boardHaloState = null;
        this.microGlints = null;
        this.microGlintState = null;
        this.heroParticles = null;
        this.debugHeroSequenceTimers = [];
        this.debugHelpersRegistered = false;
        this.animationLoopStarted = false;
        this.animate = null;
        this.burstPoolPrewarmed = false;
        this.burstPoolPrewarmScheduled = false;
        this.burstPoolPrewarmPromise = null;
        this.boundVisibilityHandler = null;
        this.deferredEffectsScheduled = false;
        this.deferredEffectsPromise = null;
        this.postSetupRetryScheduled = false;

        // Progressive blob loading
        this.pendingBlobQueue = [];
        this.blobLoadingComplete = false;

        // Tiered deferred loading
        this.frameCount = 0;
        this.deferredTier1Done = false;
        this.deferredTier2Done = false;
        this.deferredTier3Done = false;

        // Deferred background upgrade
        this.backgroundNeedsUpgrade = false;

        // Pre-allocated scratch objects to avoid GC pressure in event handlers
        this._scratchColors = Array.from({ length: 8 }, () => new THREE.Color());
        this._scratchPalette = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
        this._scratchOriginVec = new THREE.Vector3();
        this._blobDistances = new Float64Array(24); // max blobs for applyBlobReaction

        // Frame-spread burst queue: combo events can request 3-4 spark bursts
        // simultaneously, each one a CPU-intensive init (200-320 particles) +
        // GPU buffer upload. The queue lets us cap at `maxNewBurstsPerFrame`
        // actually-spawned per frame; surplus bursts wait for the next frame.
        // No new allocations after init — push/shift on the pre-existing array.
        this._burstQueue = [];
        this._burstsThisFrame = 0;

        // Reused payload object for postPipeline.updateDynamic() — avoids
        // per-frame object allocation in the animate hot path (~60 alloc/sec saved).
        this._dynPostParams = {
            time: 0,
            bloomStrength: 0,
            godRayStrength: 0,
            chromaticStrength: 0,
            vignetteDarkness: 0,
            shockwaveStrength: 0,
            shockwaveCenter: null,
            exposure: 0,
            glassRimStrength: 0,
        };

        this.modulePreloads = {
            webgpu: null,
            webgpuMaterials: null,
            post: null,
            heroParticles: null,
        };

        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.stageConductor = null;
        this.boardHaloController = null;
        this.particleOrchestrator = null;
        this.conductorChannels = {
            beatPulse: 0,
            barPhase: 0,
            phrasePhase: 0,
            bassEnergy: 0,
            midEnergy: 0,
            trebleEnergy: 0,
            overallEnergy: 0,
            actIndex: 1,
            actProgress: 0,
            boardHaloEnergy: 0,
            fieldTakeover: 0,
            heroWindow: 0,
            dominantAccent: new THREE.Color(0x00ffcc),
            supportAccent: new THREE.Color(0xff00ff),
        };
        this.tmpVec3A = new THREE.Vector3();
        this.tmpVec3B = new THREE.Vector3();
        this.tmpVec3C = new THREE.Vector3();
        this.tmpVec3D = new THREE.Vector3();
        this.tmpVec3E = new THREE.Vector3();
        this.tmpVec3F = new THREE.Vector3();
        this.tmpVec2A = new THREE.Vector2();
        this.tmpColorA = new THREE.Color();
        this.tmpColorB = new THREE.Color();
        this.baseCameraPosition = new THREE.Vector3(0, 0, 50);
        this.baseCameraLookAt = new THREE.Vector3(0, 0, 0);
        this.baseCameraFov = 60;
    }

    getTetrominoConfig() {
        return ELECTRIC_DREAMS_TETROMINOS;
    }

    async init() {
        this.applyQualityPreset(this.getCurrentQualityLevel(), { log: false });
        this.ensureStageSystems();
        this.stageConductor?.syncTrackMeta?.(true);
        this.primeModuleImports();
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality, { log = true } = {}) {
        const resolvedQuality = QUALITY_PRESETS[quality] ? quality : 'High';
        this.activeQualityLevel = resolvedQuality;
        // MRT is now controlled by the preset table itself. capabilities.supportsMRT
        // gates it at runtime (theme.js initRenderer) and post.setupWebGPU has a
        // try/catch that disables MRT if the backend rejects it — no override needed.
        this.qualityPreset = { ...QUALITY_PRESETS[resolvedQuality] };
        if (this.qualityPreset.tierCounts) {
            this.qualityPreset.blobCount = ['hero', 'support', 'ghost']
                .reduce((sum, key) => sum + (this.qualityPreset.tierCounts[key] || 0), 0);
        }
        this.stageConductor?.setQualityName?.(resolvedQuality);
        this.particleOrchestrator?.setQualityName?.(resolvedQuality);
        if (log) {
            console.log(`[ElectricDreams] Applying ${resolvedQuality} preset`);
        }
    }

    ensureStageSystems() {
        if (!this.stageConductor) {
            this.stageConductor = new StageConductor({
                audioManager: this.audioManager,
                qualityName: this.activeQualityLevel,
            });
        } else {
            this.stageConductor.setAudioManager(this.audioManager);
            this.stageConductor.setQualityName(this.activeQualityLevel);
        }

        if (!this.boardHaloController) {
            this.boardHaloController = new BoardHaloController();
        }

        if (!this.particleOrchestrator) {
            this.particleOrchestrator = new ParticleOrchestrator({
                qualityName: this.activeQualityLevel,
            });
        } else {
            this.particleOrchestrator.setQualityName(this.activeQualityLevel);
        }
    }

    initializeAdaptiveBudgetState() {
        this.adaptiveBudgetState = {
            frameTimeEMA: ADAPTIVE_BUDGET.targetFrameMs,
            qualityScale: 1,
            resolutionScale: 1,
            effectsShedLevel: 0,
        };
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedResolutionScale = 1;
        this.lastAdaptiveApplyTime = 0;
        this.lastPostToggleTime = 0;
        this.postSuppressedByBudget = false;
        this.lastAdaptivePostParams = null;
    }

    primeModuleImports() {
        if (this.modulePreloads.webgpu === null && typeof navigator !== 'undefined' && navigator.gpu) {
            this.modulePreloads.webgpu = Promise.resolve(THREE_WEBGPU);
        }

        if (this.modulePreloads.webgpuMaterials === null && typeof navigator !== 'undefined' && navigator.gpu) {
            this.modulePreloads.webgpuMaterials = Promise.resolve(ElectricDreamsMaterials);
        }

        if (this.modulePreloads.post === null && this.qualityPreset.enablePost === true) {
            this.modulePreloads.post = Promise.resolve(ElectricDreamsPostModule);
        }

        if (
            this.modulePreloads.heroParticles === null
            && typeof navigator !== 'undefined'
            && navigator.gpu
            && ['High', 'Ultra', 'Extreme'].includes(this.activeQualityLevel)
        ) {
            this.modulePreloads.heroParticles = Promise.resolve(ElectricDreamsHeroParticlesModule);
        }
    }

    resetPerformanceTelemetry() {
        const metrics = {};
        PERF_METRIC_KEYS.forEach((key) => {
            metrics[key] = createMetricBucket();
        });

        this.performanceTelemetry = {
            frameCount: 0,
            hasLoggedWarmup: false,
            metrics,
        };
    }

    recordPerformanceMetric(metricName, value) {
        if (!this.performanceTelemetry || !Number.isFinite(value)) return;

        const bucket = this.performanceTelemetry.metrics[metricName];
        if (!bucket) return;

        const alpha = 0.1;
        bucket.ema = bucket.samples.length === 0
            ? value
            : (bucket.ema * (1 - alpha)) + (value * alpha);
        bucket.samples.push(value);
        if (bucket.samples.length > PERF_HISTORY_SIZE) {
            bucket.samples.shift();
        }
    }

    getPerformanceAverage(metricName) {
        const bucket = this.performanceTelemetry?.metrics?.[metricName];
        if (!bucket?.samples?.length) return 0;

        const total = bucket.samples.reduce((sum, sample) => sum + sample, 0);
        return total / bucket.samples.length;
    }

    logPerformanceSummary(reason) {
        if (!this.performanceTelemetry) return;

        const telemetry = this.performanceTelemetry;
        const averages = {};
        const ema = {};
        PERF_METRIC_KEYS.forEach((key) => {
            averages[key] = Number(this.getPerformanceAverage(key).toFixed(2));
            ema[key] = Number((telemetry.metrics[key]?.ema || 0).toFixed(2));
        });

        console.log(`[ElectricDreams] Perf summary (${reason})`, {
            quality: this.activeQualityLevel,
            frameCount: telemetry.frameCount,
            sparkCount: this.sparks?.count ?? 0,
            usePost: this.flags.usePost,
            useMRT: this.flags.useMRT,
            useCompute: this.flags.useCompute,
            rendererPixelRatio: Number((this.renderer?.getPixelRatio?.() || 1).toFixed(2)),
            qualityScale: Number((this.adaptiveBudgetState?.qualityScale ?? 1).toFixed(3)),
            resolutionScale: Number((this.adaptiveBudgetState?.resolutionScale ?? 1).toFixed(3)),
            effectsShedLevel: this.adaptiveBudgetState?.effectsShedLevel ?? 0,
            stageHeat: Number((this.fxState?.stageHeat ?? 0).toFixed(3)),
            averages,
            ema,
        });
    }

    maybeLogWarmupSummary() {
        if (!this.performanceTelemetry) return;

        this.performanceTelemetry.frameCount += 1;
        if (!this.performanceTelemetry.hasLoggedWarmup
            && this.performanceTelemetry.frameCount >= PERF_WARMUP_FRAMES) {
            this.performanceTelemetry.hasLoggedWarmup = true;
            this.logPerformanceSummary('warmup');
        }
    }

    getMaxRendererPixelRatio() {
        return this.isWebGPU ? 1.0 : 1.2;
    }

    getRendererPixelRatio(maxRatio = this.getMaxRendererPixelRatio()) {
        const baseRatio = this.getEffectivePixelRatio(maxRatio);
        const resolutionScale = this.adaptiveBudgetState?.resolutionScale ?? 1;
        return THREE.MathUtils.clamp(baseRatio * resolutionScale, 0.35, maxRatio);
    }

    updateRendererSurfaceSize(width, height) {
        if (!this.renderer) return;

        this.renderer.setSize(width, height, false);
        if (this.renderer.domElement?.style) {
            this.renderer.domElement.style.width = `${width}px`;
            this.renderer.domElement.style.height = `${height}px`;
        }
    }

    getCurrentSparkPixelRatio() {
        return this.renderer?.getPixelRatio?.() || this.getRendererPixelRatio();
    }

    getAdaptivePostParams() {
        if (!this.postProfile) return null;

        const qualityScale = this.adaptiveBudgetState?.qualityScale ?? 1;
        const resolutionScale = this.adaptiveBudgetState?.resolutionScale ?? 1;
        const baseGrain = this.postProfile.useFilmGrain ? (this.postProfile.grainStrength ?? 0.001) : 0;

        return {
            resolutionScale,
            bloomDownsample: THREE.MathUtils.clamp(
                (this.postProfile.bloomDownsample ?? 0.5) * qualityScale,
                0.35,
                this.postProfile.bloomDownsample ?? 0.5,
            ),
            chromaticStrength: (this.postProfile.chromaticStrength ?? 0) * qualityScale,
            godRayStrength: (this.postProfile.godRayStrength ?? 0) * qualityScale,
            grainStrength: baseGrain * qualityScale,
        };
    }

    syncSparkPixelRatio() {
        if (this.sparkUniforms?.uPixelRatio) {
            this.sparkUniforms.uPixelRatio.value = this.getCurrentSparkPixelRatio();
        }
    }

    applyAdaptivePostParams(force = false) {
        if (!this.postPipeline) return;

        const params = this.getAdaptivePostParams();
        if (!params) return;

        const previous = this.lastAdaptivePostParams;
        const changed = force || !previous
            || Math.abs(previous.resolutionScale - params.resolutionScale) >= 0.01
            || Math.abs(previous.bloomDownsample - params.bloomDownsample) >= 0.01
            || Math.abs(previous.chromaticStrength - params.chromaticStrength) >= 0.0005
            || Math.abs(previous.godRayStrength - params.godRayStrength) >= 0.01
            || Math.abs(previous.grainStrength - params.grainStrength) >= 0.0005;

        if (!changed) return;

        this.postPipeline.update(params);
        this.lastAdaptivePostParams = { ...params };
    }

    maybeUpdateAdaptivePostState(nowMs) {
        if (!this.capabilities.supportsPost || !this.qualityPreset.enablePost || this.flags.noPost) {
            return;
        }

        if ((nowMs - this.lastPostToggleTime) < ADAPTIVE_BUDGET.postToggleCooldownMs) return;

        const qualityScale = this.adaptiveBudgetState?.qualityScale ?? 1;
        if (!this.postSuppressedByBudget && this.flags.usePost && qualityScale <= ADAPTIVE_BUDGET.postDisableScale) {
            this.flags.usePost = false;
            this.postSuppressedByBudget = true;
            this.lastPostToggleTime = nowMs;
            return;
        }

        if (
            this.postSuppressedByBudget
            && this.capabilities.supportsPost
            && qualityScale >= ADAPTIVE_BUDGET.postEnableScale
        ) {
            this.flags.usePost = true;
            this.postSuppressedByBudget = false;
            this.lastPostToggleTime = nowMs;
        }
    }

    applyAdaptiveBudgetState(force = false) {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const pixelRatio = this.getRendererPixelRatio();
        const resolutionScale = this.adaptiveBudgetState?.resolutionScale ?? 1;

        const sizeChanged = force || width !== this.lastRendererWidth || height !== this.lastRendererHeight;
        const pixelRatioChanged = force || Math.abs(pixelRatio - this.lastRendererPixelRatio) >= 0.02;
        const resolutionChanged = force || Math.abs(resolutionScale - this.lastAppliedResolutionScale) >= 0.01;

        if (pixelRatioChanged) {
            this.renderer.setPixelRatio(pixelRatio);
            this.composer?.setPixelRatio?.(pixelRatio);
            this.postPipeline?.setPixelRatio?.(pixelRatio);
            this.syncSparkPixelRatio();
            this.lastRendererPixelRatio = pixelRatio;
        }

        if (sizeChanged || pixelRatioChanged) {
            this.updateRendererSurfaceSize(width, height);
            this.postPipeline?.setSize(width, height);
            this.composer?.setSize(width, height);
            this.lastRendererWidth = width;
            this.lastRendererHeight = height;
        }

        if (resolutionChanged || force) {
            this.applyAdaptivePostParams(force);
            this.lastAppliedResolutionScale = resolutionScale;
        }

        this.applyAmbientDrawRange();
        this.applyMicroGlintVisibility();
    }

    getEffectsShedLevelForFrame(frameTimeEMA) {
        const ratio = frameTimeEMA / ADAPTIVE_BUDGET.targetFrameMs;
        if (ratio >= 1.55) return 5;
        if (ratio >= 1.4) return 4;
        if (ratio >= 1.28) return 3;
        if (ratio >= 1.16) return 2;
        if (ratio >= 1.06) return 1;
        return 0;
    }

    setEffectsShedLevel(level) {
        if (!this.adaptiveBudgetState) return;
        const clampedLevel = THREE.MathUtils.clamp(Math.round(level), 0, 5);
        if (clampedLevel === this.adaptiveBudgetState.effectsShedLevel) return;
        this.adaptiveBudgetState.effectsShedLevel = clampedLevel;
        this.applyAmbientDrawRange();
        this.applyMicroGlintVisibility();
    }

    getAmbientDensityMultiplier() {
        const shedLevel = this.adaptiveBudgetState?.effectsShedLevel ?? 0;
        return this.particleOrchestrator?.getAmbientDensityMultiplier?.(
            this.conductorChannels,
            this.fxState?.stageHeat ?? 0,
            shedLevel,
        ) ?? 1;
    }

    getComboStreamerMultiplier() {
        const shedLevel = this.adaptiveBudgetState?.effectsShedLevel ?? 0;
        return this.particleOrchestrator?.getComboStreamerMultiplier?.(
            this.conductorChannels,
            shedLevel,
        ) ?? 1;
    }

    getHeroParticleDensityScale() {
        if (!['High', 'Ultra', 'Extreme'].includes(this.activeQualityLevel)) return 0;
        return this.particleOrchestrator?.getHeroParticleScale?.(
            this.conductorChannels,
            this.adaptiveBudgetState?.effectsShedLevel ?? 0,
        ) ?? 0;
    }

    getDropletMultiplier() {
        return this.particleOrchestrator?.getDropletMultiplier?.(
            this.conductorChannels,
            this.adaptiveBudgetState?.effectsShedLevel ?? 0,
        ) ?? 1;
    }

    shouldAllowSecondaryWakes() {
        return this.particleOrchestrator?.shouldAllowSecondaryWakes?.(
            this.adaptiveBudgetState?.effectsShedLevel ?? 0,
        ) ?? true;
    }

    applyAmbientDrawRange() {
        if (!this.sparks?.geometry) return;
        const totalCount = this.sparks.count || this.qualityPreset.particleCount || 0;
        if (!Number.isFinite(totalCount) || totalCount <= 0) return;
        const densityBoost = 1
            + (this.fxState?.rewardPulse || 0) * 0.06
            + (this.fxState?.overdrivePulse || 0) * 0.08
            + (this.fxState?.dangerLevel || 0) * 0.04;
        const visibleCount = Math.max(12, Math.round(totalCount * this.getAmbientDensityMultiplier() * densityBoost));
        this.sparks.geometry.setDrawRange(0, Math.min(totalCount, visibleCount));
    }

    applyMicroGlintVisibility() {
        if (!this.microGlints?.material) return;
        const hiddenByBudget = (this.adaptiveBudgetState?.effectsShedLevel ?? 0) >= 1;
        this.microGlints.visible = !hiddenByBudget && (this.qualityPreset.microGlintCount ?? 0) > 0;
    }

    shouldUseHeroParticles() {
        return Boolean(
            this.isWebGPU
            && this.webgpuMaterials
            && this.scene
            && this.camera
            && ['High', 'Ultra', 'Extreme'].includes(this.activeQualityLevel),
        );
    }

    async initializeHeroParticles() {
        if (!this.shouldUseHeroParticles() || this.heroParticles) return this.heroParticles;

        try {
            const heroModule = this.modulePreloads.heroParticles
                ? await this.modulePreloads.heroParticles
                : ElectricDreamsHeroParticlesModule;
            const { ElectricDreamsHeroParticles } = heroModule;
            this.heroParticles = new ElectricDreamsHeroParticles({
                scene: this.scene,
                camera: this.camera,
                qualityName: this.activeQualityLevel,
                webgpuMaterials: this.webgpuMaterials,
                applyMrtPatch: (material) => this.applyMrtPatchToMaterial(material),
            });
        } catch (error) {
            console.warn('[ElectricDreams] Failed to initialize hero particles:', error);
            this.heroParticles = null;
        }

        return this.heroParticles;
    }

    destroyHeroParticles() {
        if (!this.heroParticles) return;
        this.heroParticles.dispose();
        this.heroParticles = null;
    }

    getHeroEmissionAnchors(origin, count = 2) {
        return this.getSurfaceEmissionAnchors(origin, count);
    }

    getBlobRenderRadius(blob) {
        if (!blob) return 1;
        const renderScale = blob.mainMesh?.scale?.x;
        const baseScale = Number.isFinite(renderScale) ? renderScale : (blob.scale || blob.baseScale || 1);
        return Math.max(0.85, baseScale * 1.04);
    }

    getBlobFlowReference(blob, out = this.tmpVec3A) {
        out.set(0, 0.14, 1);
        if (blob?.clusterFlowDirection?.lengthSq?.() > 0.0001) {
            out.copy(blob.clusterFlowDirection);
        } else if (blob?.reactionVector?.lengthSq?.() > 0.0001) {
            out.copy(blob.reactionVector);
        } else if (blob?.velocity?.lengthSq?.() > 0.0001) {
            out.copy(blob.velocity);
        }
        return out.normalize();
    }

    createEmissionAnchor(position, direction, normal = null, behavior = 'streamer') {
        if (!position || !direction) return null;
        const resolvedNormal = normal && normal.lengthSq() > 0.0001
            ? normal
            : this.tmpVec3D.set(0, 0, 1);
        return {
            position: position.clone(),
            direction: direction.clone().normalize(),
            normal: resolvedNormal.clone().normalize(),
            behavior,
        };
    }

    createBlobSurfaceAnchor(blob, targetPoint = null, options = {}) {
        if (!blob?.mainMesh?.position) return null;

        const {
            radiusScale = 1.02,
            direction = null,
            behavior = 'surface',
            tangentBias = 0.2,
        } = options;

        const center = blob.mainMesh.position;
        const radius = this.getBlobRenderRadius(blob) * radiusScale;
        const normal = this.tmpVec3A.copy(targetPoint || center).sub(center);
        if (normal.lengthSq() <= 0.0001) {
            this.getBlobFlowReference(blob, normal);
        }
        normal.normalize();

        const position = this.tmpVec3B.copy(center).addScaledVector(normal, radius);
        const eventDirection = direction
            ? this.tmpVec3C.copy(direction)
            : this.tmpVec3C.copy(targetPoint || center).sub(position);
        if (eventDirection.lengthSq() <= 0.0001) {
            this.getBlobFlowReference(blob, eventDirection);
        }
        eventDirection.normalize();

        const tangent = this.tmpVec3D.copy(eventDirection).projectOnPlane(normal);
        if (tangent.lengthSq() <= 0.0001) {
            this.getBlobFlowReference(blob, tangent);
            tangent.projectOnPlane(normal);
        }
        if (tangent.lengthSq() <= 0.0001) {
            tangent.crossVectors(normal, this.tmpVec3E.set(0, 0, 1));
        }
        if (tangent.lengthSq() <= 0.0001) {
            tangent.set(normal.y, -normal.x, 0.18);
        }
        tangent.normalize();

        if (tangentBias > 0) {
            tangent.lerp(this.getBlobFlowReference(blob, this.tmpVec3F), tangentBias).normalize();
        }

        return this.createEmissionAnchor(position, tangent, normal, behavior);
    }

    getRandomAmbientBlobIndex(preferForeground = true) {
        const total = this.blobs.length;
        if (total <= 0) return -1;

        const start = Math.floor(Math.random() * total);
        for (let step = 0; step < total; step += 1) {
            const index = (start + step) % total;
            if (!preferForeground || this.blobs[index]?.tier !== 'ghost') {
                return index;
            }
        }

        return start;
    }

    findAmbientBridgePartnerIndex(primaryIndex) {
        const primaryBlob = this.blobs[primaryIndex];
        if (!primaryBlob?.mainMesh?.position) return -1;

        const primaryPosition = primaryBlob.mainMesh.position;
        const primaryRadius = this.getBlobRenderRadius(primaryBlob);
        let bestIndex = -1;
        let bestScore = Number.POSITIVE_INFINITY;

        for (let i = 0; i < this.blobs.length; i += 1) {
            if (i === primaryIndex) continue;
            const candidate = this.blobs[i];
            const candidatePosition = candidate?.mainMesh?.position;
            if (!candidatePosition) continue;

            const distance = primaryPosition.distanceTo(candidatePosition);
            const combinedRadius = primaryRadius + this.getBlobRenderRadius(candidate);
            const targetDistance = combinedRadius * 1.34;
            const tierPenalty = candidate.tier === 'ghost' ? combinedRadius * 0.28 : 0;
            const score = Math.abs(distance - targetDistance) + tierPenalty;
            if (score < bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    getSurfaceEmissionAnchors(origin, count = 2, options = {}) {
        if (!this.blobs.length) return [];
        return this.selectBurstSourceBlobs(count, origin)
            .map((blob) => this.createBlobSurfaceAnchor(blob, origin, options))
            .filter(Boolean);
    }

    getBridgeEmissionAnchors(origin, count = 2, options = {}) {
        if (!this.blobs.length) return [];

        const anchors = [];
        const sourceBlobs = this.selectBurstSourceBlobs(Math.max(2, count), origin);

        sourceBlobs.forEach((blob) => {
            if (!blob || anchors.length >= count) return;
            const primaryIndex = this.blobs.indexOf(blob);
            const secondaryIndex = this.findAmbientBridgePartnerIndex(primaryIndex);
            const secondaryBlob = this.blobs[secondaryIndex];
            if (!blob?.mainMesh?.position || !secondaryBlob?.mainMesh?.position) return;

            const posA = blob.mainMesh.position;
            const posB = secondaryBlob.mainMesh.position;
            const radiusA = this.getBlobRenderRadius(blob);
            const radiusB = this.getBlobRenderRadius(secondaryBlob);
            const combinedRadius = radiusA + radiusB;

            this.tmpVec3A.copy(posB).sub(posA);
            const distance = this.tmpVec3A.length();
            if (!Number.isFinite(distance) || distance <= 0.0001) return;
            this.tmpVec3A.normalize();

            const midpoint = this.tmpVec3B.copy(posA).lerp(posB, 0.5);
            const outward = this.tmpVec3C.set(midpoint.x, midpoint.y * 0.16, 0.3 + Math.abs(midpoint.z) * 0.02);
            if (outward.lengthSq() <= 0.0001) {
                outward.set(midpoint.x >= 0 ? 1 : -1, 0.14, 0.28);
            }
            outward.normalize();

            const seamPosition = midpoint.clone()
                .addScaledVector(outward, combinedRadius * 0.18)
                .addScaledVector(this.tmpVec3A, (Math.random() - 0.5) * distance * 0.32);
            const tangent = this.tmpVec3D.copy(this.tmpVec3A).lerp(outward, 0.26).normalize();
            anchors.push(this.createEmissionAnchor(seamPosition, tangent, outward, options.behavior || 'bridge'));
        });

        if (anchors.length < count) {
            anchors.push(...this.getSurfaceEmissionAnchors(origin, count - anchors.length, options));
        }

        return anchors.slice(0, count);
    }

    updateAdaptiveBudgets(frameMs, nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
        if (!Number.isFinite(frameMs) || !this.adaptiveBudgetState) return;

        const state = this.adaptiveBudgetState;
        state.frameTimeEMA = (state.frameTimeEMA * 0.92) + (frameMs * 0.08);
        const targetShedLevel = this.getEffectsShedLevelForFrame(state.frameTimeEMA);
        const currentShedLevel = state.effectsShedLevel ?? 0;
        if (targetShedLevel > currentShedLevel) {
            this.setEffectsShedLevel(targetShedLevel);
        } else if (
            targetShedLevel < currentShedLevel
            && state.frameTimeEMA < ADAPTIVE_BUDGET.targetFrameMs * 0.96
        ) {
            this.setEffectsShedLevel(currentShedLevel - 1);
        }

        if (!ADAPTIVE_BUDGET.dynamicResolutionEnabled) {
            return;
        }

        this.maybeUpdateAdaptivePostState(nowMs);

        if ((nowMs - this.lastAdaptiveApplyTime) < ADAPTIVE_BUDGET.applyIntervalMs) {
            return;
        }

        let nextScale = state.qualityScale;
        if (state.frameTimeEMA > ADAPTIVE_BUDGET.targetFrameMs * 1.08) {
            nextScale -= ADAPTIVE_BUDGET.adaptiveDownRate;
        } else if (state.frameTimeEMA < ADAPTIVE_BUDGET.targetFrameMs * 0.88) {
            nextScale += ADAPTIVE_BUDGET.adaptiveUpRate;
        }

        nextScale = THREE.MathUtils.clamp(
            nextScale,
            ADAPTIVE_BUDGET.adaptiveMinScale,
            ADAPTIVE_BUDGET.adaptiveMaxScale,
        );

        const downgraded = nextScale < state.qualityScale - 0.009;
        if (Math.abs(nextScale - state.qualityScale) >= 0.01) {
            state.qualityScale = nextScale;
            state.resolutionScale = THREE.MathUtils.clamp(
                nextScale,
                ADAPTIVE_BUDGET.minResolutionScale,
                ADAPTIVE_BUDGET.maxResolutionScale,
            );
        }

        this.maybeUpdateAdaptivePostState(nowMs);
        this.applyAdaptiveBudgetState();
        this.lastAdaptiveApplyTime = nowMs;

        if (downgraded) {
            this.logPerformanceSummary('adaptive-downgrade');
        }
    }

    getSharedBlobGeometry(detail) {
        const resolvedDetail = Math.max(1, Math.floor(detail));
        const cacheKey = `ico-${resolvedDetail}`;
        if (!this.geometryCache.has(cacheKey)) {
            this.geometryCache.set(cacheKey, new THREE.IcosahedronGeometry(1, resolvedDetail));
        }
        return this.geometryCache.get(cacheKey);
    }

    selectBurstSourceBlobs(sourceCount = 1, origin = null) {
        if (!this.blobs.length) return [];

        const count = Math.max(1, Math.min(sourceCount, this.blobs.length));
        const ranked = [...this.blobs]
            .map((blob) => {
                const pos = blob.mainMesh?.position;
                let centerScore = Number.MAX_SAFE_INTEGER;
                if (pos) {
                    if (origin) {
                        centerScore = pos.distanceTo(origin);
                    } else {
                        centerScore = (
                            Math.abs(pos.x) / Math.max(this.screenBounds.width, 1)
                            + Math.abs(pos.y) / Math.max(this.screenBounds.height, 1)
                            + Math.abs(pos.z) / 20
                        );
                    }
                }
                return { blob, centerScore };
            })
            .sort((a, b) => a.centerScore - b.centerScore)
            .map(({ blob }) => blob);

        const candidateCount = Math.max(count, Math.min(ranked.length, count * 2));
        const candidates = ranked.slice(0, candidateCount);
        const offset = candidates.length > 0 ? Math.floor((this.time * 2.7) % candidates.length) : 0;

        return Array.from({ length: count }, (_, index) => candidates[(offset + index) % candidates.length]);
    }

    destroyBurstBlobResources(burstBlob) {
        if (!burstBlob) return;

        burstBlob.meshes?.forEach((mesh) => {
            if (!mesh) return;
            if (mesh.material) {
                mesh.material.dispose();
            }
            this.scene?.remove(mesh);
        });
    }

    deactivateBurstBlob(burstBlob) {
        if (!burstBlob) return;

        burstBlob.active = false;
        burstBlob.age = 0;
        burstBlob.life = 1;
        burstBlob.strength = 0;
        burstBlob.mainMesh.visible = false;
        burstBlob.glowMesh.visible = false;

        if (burstBlob.mainUniforms) {
            burstBlob.mainUniforms.uPulseIntensity.value = 0;
            burstBlob.mainUniforms.uMorphFactor.value = 0;
            if (burstBlob.mainUniforms.uOpacity) {
                burstBlob.mainUniforms.uOpacity.value = 0;
            }
        } else if (burstBlob.mainMesh?.material) {
            burstBlob.mainMesh.material.opacity = 0;
        }

        if (burstBlob.glowUniforms) {
            burstBlob.glowUniforms.uGlowIntensity.value = 0;
            if (burstBlob.glowUniforms.uOpacity) {
                burstBlob.glowUniforms.uOpacity.value = 0;
            }
        } else if (burstBlob.glowMesh?.material) {
            burstBlob.glowMesh.material.opacity = 0;
        }
    }

    createSingleBurstBlob() {
        if (!this.scene) return null;

        const burstDetail = Math.max(1, Math.min(2, (this.qualityPreset.blobDetail || 2) - 1));
        const geometry = this.getSharedBlobGeometry(burstDetail);
        const color = BLOB_COLORS[this.burstBlobs.length % BLOB_COLORS.length].clone();

        const burstBlob = {
            active: false,
            age: 0,
            life: 1,
            strength: 0,
            phase: Math.random() * Math.PI * 2,
            baseScale: 1,
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            angularVelocity: new THREE.Vector3(),
            color,
            meshes: [],
            mainMesh: null,
            glowMesh: null,
            mainUniforms: null,
            glowUniforms: null,
        };

        if (this.isWebGPU && this.webgpuMaterials) {
            const { material: mainMaterial, uniforms: mainUniforms } = this.webgpuMaterials.createBlobNodeMaterial({
                color,
                opacity: 0,
            });
            this.applyMrtPatchToMaterial(mainMaterial);

            const {
                material: glowMaterial,
                uniforms: glowUniforms,
            } = this.webgpuMaterials.createBlobGlowNodeMaterial({
                color,
                glowIntensity: 0,
                opacity: 0,
            });
            this.applyMrtPatchToMaterial(glowMaterial);

            const mainMesh = new THREE.Mesh(geometry, mainMaterial);
            mainMesh.renderOrder = 2;
            mainMesh.userData.baseScaleMultiplier = 1;
            mainMesh.frustumCulled = false;

            const glowMesh = new THREE.Mesh(geometry, glowMaterial);
            glowMesh.renderOrder = 1;
            glowMesh.userData.baseScaleMultiplier = 1.16;
            glowMesh.frustumCulled = false;

            this.scene.add(mainMesh);
            this.scene.add(glowMesh);

            burstBlob.mainMesh = mainMesh;
            burstBlob.glowMesh = glowMesh;
            burstBlob.mainUniforms = mainUniforms;
            burstBlob.glowUniforms = glowUniforms;
            burstBlob.meshes.push(mainMesh, glowMesh);
        } else {
            const mainMaterial = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0,
                depthWrite: false,
            });
            const glowMaterial = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.BackSide,
            });

            const mainMesh = new THREE.Mesh(geometry, mainMaterial);
            mainMesh.userData.baseScaleMultiplier = 1;
            mainMesh.frustumCulled = false;

            const glowMesh = new THREE.Mesh(geometry, glowMaterial);
            glowMesh.userData.baseScaleMultiplier = 1.14;
            glowMesh.frustumCulled = false;

            this.scene.add(mainMesh);
            this.scene.add(glowMesh);

            burstBlob.mainMesh = mainMesh;
            burstBlob.glowMesh = glowMesh;
            burstBlob.meshes.push(mainMesh, glowMesh);
        }

        this.deactivateBurstBlob(burstBlob);
        this.burstBlobs.push(burstBlob);
        return burstBlob;
    }

    initializeBurstPool() {
        if (!this.scene || this.burstBlobs.length > 0) return;

        const initialPoolSize = Math.min(4, BURST_BLOB_CONFIG.maxActive);
        for (let i = 0; i < initialPoolSize; i += 1) {
            this.createSingleBurstBlob();
        }
    }

    async prewarmBurstPool() {
        if (!this.renderer || !this.scene || !this.camera || !this.burstBlobs.length) return false;
        if (typeof document !== 'undefined' && document.hidden) return false;

        const canCompileAsync = typeof this.renderer.compileAsync === 'function';
        if (!canCompileAsync) return false;

        this.burstBlobs.forEach((burstBlob, index) => {
            const row = Math.floor(index / 4);
            const col = index % 4;
            const x = (col - 1.5) * 4;
            const y = (row - 1) * 3;

            burstBlob.mainMesh.visible = true;
            burstBlob.glowMesh.visible = true;
            burstBlob.mainMesh.position.set(x, y, 8);
            burstBlob.glowMesh.position.set(x, y, 8);
            burstBlob.mainMesh.scale.setScalar(0.75);
            burstBlob.glowMesh.scale.setScalar(0.86);

            if (burstBlob.mainUniforms) {
                burstBlob.mainUniforms.uTime.value = this.time;
                burstBlob.mainUniforms.uColor.value.copy(burstBlob.color);
                burstBlob.mainUniforms.uPulseIntensity.value = 0.22;
                burstBlob.mainUniforms.uMorphFactor.value = 0.3;
                if (burstBlob.mainUniforms.uOpacity) {
                    burstBlob.mainUniforms.uOpacity.value = 0.04;
                }
            } else if (burstBlob.mainMesh.material) {
                burstBlob.mainMesh.material.opacity = 0.04;
            }

            if (burstBlob.glowUniforms) {
                burstBlob.glowUniforms.uTime.value = this.time;
                burstBlob.glowUniforms.uColor.value.copy(burstBlob.color);
                burstBlob.glowUniforms.uGlowIntensity.value = 0.2;
                if (burstBlob.glowUniforms.uOpacity) {
                    burstBlob.glowUniforms.uOpacity.value = 0.05;
                }
            } else if (burstBlob.glowMesh.material) {
                burstBlob.glowMesh.material.opacity = 0.05;
            }
        });

        const prewarmSpark = this.gameplaySparkBursts[0];
        if (prewarmSpark) {
            this.spawnGameplaySparkBurst({
                origin: new THREE.Vector3(0, 0, -2),
                count: 8,
                life: 0.5,
                intensity: 0.6,
                size: 0.35,
                palette: [BLOB_COLORS[0], BLOB_COLORS[1], BLOB_COLORS[4]],
                direction: new THREE.Vector3(0.1, 0.2, 1),
                pattern: 'combo',
            });
        }

        const prewarmWake = this.lineWakes[0];
        if (prewarmWake) {
            this.spawnLineWake({
                y: 0,
                height: 0.2,
                intensity: 0.65,
                life: 0.45,
                color: BLOB_COLORS[1],
            });
        }

        this.heroParticles?.prewarm(this.time);

        try {
            await this.renderer.compileAsync(this.scene, this.camera);
            return true;
        } catch (error) {
            console.warn('[ElectricDreams] Burst pool prewarm failed:', error);
            return false;
        } finally {
            this.burstBlobs.forEach((burstBlob) => this.deactivateBurstBlob(burstBlob));
            this.gameplaySparkBursts.forEach((burst) => this.deactivateGameplaySparkBurst(burst));
            this.lineWakes.forEach((wake) => this.deactivateLineWake(wake));
            this.heroParticles?.reset();
        }
    }

    scheduleBurstPoolPrewarm(delayMs = 120) {
        if (
            !this.isWebGPU
            || this.burstPoolPrewarmed
            || this.burstPoolPrewarmPromise
            || this.burstPoolPrewarmScheduled
            || !this.isActive
        ) {
            return;
        }

        if (this.burstBlobs.length === 0) {
            this.scheduleDeferredEffects(Math.min(delayMs, 60));
            return;
        }

        if (typeof document !== 'undefined' && document.hidden) {
            return;
        }

        this.burstPoolPrewarmScheduled = true;
        this.registerTimeout(() => {
            this.burstPoolPrewarmScheduled = false;
            this.prewarmBurstPoolInBackground();
        }, delayMs);
    }

    async prewarmBurstPoolInBackground() {
        if (
            this.burstPoolPrewarmed
            || this.burstPoolPrewarmPromise
            || !this.isActive
        ) {
            return this.burstPoolPrewarmPromise;
        }

        if (typeof document !== 'undefined' && document.hidden) {
            return null;
        }

        this.burstPoolPrewarmPromise = this.prewarmBurstPool()
            .then((didPrewarm) => {
                if (didPrewarm) {
                    this.burstPoolPrewarmed = true;
                }
                return didPrewarm;
            })
            .finally(() => {
                this.burstPoolPrewarmPromise = null;
            });

        return this.burstPoolPrewarmPromise;
    }

    queueBackgroundTask(task, delayMs = 0, options = {}) {
        const { idle = true, timeout = 1200 } = options;
        this.registerTimeout(() => {
            if (!this.isActive) return;

            const runTask = () => {
                Promise.resolve()
                    .then(() => task())
                    .catch((error) => {
                        console.warn('[ElectricDreams] Background task failed:', error);
                    });
            };

            if (idle && typeof requestIdleCallback === 'function') {
                requestIdleCallback(() => runTask(), { timeout });
                return;
            }

            runTask();
        }, Math.max(0, delayMs));
    }

    chainDeferredBackgroundTask(task, delayMs = 0, options = {}) {
        const previous = this.deferredEffectsPromise || Promise.resolve();
        this.deferredEffectsPromise = previous.then(() => new Promise((resolve) => {
            this.queueBackgroundTask(async () => {
                try {
                    await task();
                } finally {
                    resolve();
                }
            }, delayMs, options);
        }));
        return this.deferredEffectsPromise;
    }

    scheduleDeferredEffects(delayMs = 40) {
        if (!this.isActive) return;

        this.deferredTier1Done = false;
        this.deferredTier2Done = false;
        this.deferredTier3Done = false;
        this.frameCount = 0;

        if (this.deferredEffectsScheduled) return;

        this.deferredEffectsScheduled = true;
        this.deferredEffectsPromise = Promise.resolve();

        this.chainDeferredBackgroundTask(() => {
            if (this.deferredTier1Done) return;
            this.deferredTier1Done = true;
            this.executeDeferredTier1();
        }, delayMs, { idle: false });

        this.chainDeferredBackgroundTask(async () => {
            if (this.deferredTier2Done) return;
            this.deferredTier2Done = true;
            await this.executeDeferredTier2();
        }, delayMs + 90, { idle: true, timeout: 800 });

        this.chainDeferredBackgroundTask(async () => {
            if (this.deferredTier3Done) return;
            this.deferredTier3Done = true;
            await this.executeDeferredTier3();
        }, delayMs + 220, { idle: true, timeout: 1400 });

        this.deferredEffectsPromise = this.deferredEffectsPromise.finally(() => {
            this.deferredEffectsScheduled = false;
            this.deferredEffectsPromise = null;
        });
    }

    // ── Tiered deferred loading (replaces monolithic initializeDeferredEffectsInBackground) ──

    executeDeferredTier1() {
        try {
            if (this.isWebGPU) {
                this.attachDeferredBlobLayers();
                if (this.qualityPreset.useGlassOverlay && !this.glassMesh) {
                    this.createGlassOverlay();
                }
            }
            this.upgradeBackground();
        } catch (err) {
            console.warn('[ElectricDreams] Deferred tier 1 failed:', err);
        }
    }

    async executeDeferredTier2() {
        try {
            if (!this.sparks) {
                await this.createSparkSystem();
            }
            if ((this.qualityPreset.microGlintCount ?? 0) > 0 && !this.microGlints) {
                this.createMicroGlints();
            }
            if ((this.qualityPreset.boardHaloEmberCount ?? 0) > 0 && !this.boardHaloEmbers) {
                this.createBoardHaloEmbers();
            }
            if (this.gameplaySparkBursts.length === 0) {
                this.initializeGameplaySparkPools();
            }
            if (this.lineWakes.length === 0) {
                this.initializeLineWakePool();
            }
        } catch (err) {
            console.warn('[ElectricDreams] Deferred tier 2 failed:', err);
        }
    }

    async executeDeferredTier3() {
        try {
            if (this.shouldUseHeroParticles() && !this.heroParticles) {
                await this.initializeHeroParticles();
            }
            if (this.burstBlobs.length === 0) {
                this.initializeBurstPool();
            }
            if (
                this.flags.usePost
                && !this.postPipeline
                && !this.composer
            ) {
                await this.setupPostProcessing();
            }
            if (this.isWebGPU) {
                this.scheduleBurstPoolPrewarm(180);
            }
        } catch (err) {
            console.warn('[ElectricDreams] Deferred tier 3 failed:', err);
        }
    }

    acquireBurstBlob() {
        // Find first inactive burst blob (indexed loop, no closure)
        for (let i = 0; i < this.burstBlobs.length; i++) {
            if (this.burstBlobs[i].active !== true) return this.burstBlobs[i];
        }

        // Grow pool on demand if under max capacity
        if (this.burstBlobs.length < BURST_BLOB_CONFIG.maxActive) {
            return this.createSingleBurstBlob();
        }

        // Recycle the oldest active burst blob (indexed loop, no closure)
        let oldest = null;
        let oldestProgress = -1;
        for (let i = 0; i < this.burstBlobs.length; i++) {
            const progress = this.burstBlobs[i].age / Math.max(this.burstBlobs[i].life, 0.0001);
            if (progress > oldestProgress) {
                oldestProgress = progress;
                oldest = this.burstBlobs[i];
            }
        }
        return oldest;
    }

    spawnBurstBlob(sourceBlob, strength = 0.45, eventOrigin = null) {
        if (!this.scene || !sourceBlob?.mainMesh || !this.burstBlobs.length) return;

        const burstBlob = this.acquireBurstBlob();
        if (!burstBlob) return;

        const sourcePosition = sourceBlob.mainMesh.position;
        const sourceScale = sourceBlob.baseScale || sourceBlob.scale || 3;
        const spawnOrigin = eventOrigin || sourcePosition;
        const radialDir = this.tmpVec3A.copy(sourcePosition).sub(spawnOrigin);
        if (radialDir.lengthSq() < 0.001) {
            radialDir.set(Math.random() - 0.5, Math.random() - 0.5, 0);
        }
        radialDir.normalize();

        const jitterDir = this.tmpVec3B.set(Math.random() - 0.5, Math.random() - 0.5, 0);
        jitterDir.normalize();
        const combinedDir = this.tmpVec3C.copy(radialDir).multiplyScalar(0.72).add(
            this.tmpVec3D.copy(jitterDir).multiplyScalar(0.48),
        ).normalize();

        burstBlob.position.copy(spawnOrigin).lerp(sourcePosition, 0.58);
        burstBlob.position.addScaledVector(combinedDir, sourceScale * (0.38 + Math.random() * 0.22));
        burstBlob.position.x += (Math.random() - 0.5) * sourceScale * 0.2;
        burstBlob.position.y += (Math.random() - 0.5) * sourceScale * 0.2;

        burstBlob.velocity.set(
            combinedDir.x * (BURST_BLOB_CONFIG.radialSpeed + Math.random() * 3.5)
                + (Math.random() - 0.5) * BURST_BLOB_CONFIG.jitterSpeed,
            combinedDir.y * (BURST_BLOB_CONFIG.radialSpeed + Math.random() * 3.5)
                + (Math.random() - 0.5) * BURST_BLOB_CONFIG.jitterSpeed,
            BURST_BLOB_CONFIG.towardCameraSpeed + Math.random() * 4 + strength * 5.5,
        );
        burstBlob.angularVelocity.set(
            (Math.random() - 0.5) * 0.08,
            (Math.random() - 0.5) * 0.08,
            (Math.random() - 0.5) * 0.08,
        );
        burstBlob.baseScale = THREE.MathUtils.clamp(
            sourceScale * (
                BURST_BLOB_CONFIG.minScaleFactor
                + Math.random() * (BURST_BLOB_CONFIG.maxScaleFactor - BURST_BLOB_CONFIG.minScaleFactor)
                + strength * 0.03
            ),
            0.7,
            3.2,
        );
        burstBlob.color.copy(sourceBlob.currentColor || sourceBlob.baseColor || BLOB_COLORS[0]);
        burstBlob.color.offsetHSL((Math.random() - 0.5) * 0.015, 0.04, 0.025);
        burstBlob.age = 0;
        burstBlob.life = BURST_BLOB_CONFIG.baseLife
            + (Math.random() * BURST_BLOB_CONFIG.maxLifeJitter)
            + (strength * 0.12);
        burstBlob.strength = strength;
        burstBlob.phase = Math.random() * Math.PI * 2;
        burstBlob.active = true;

        burstBlob.mainMesh.visible = true;
        burstBlob.glowMesh.visible = true;
    }

    queueBlobBurst({
        fragments = 2,
        strength = 0.35,
        sourceCount = 1,
        origin = null,
    } = {}) {
        const targetFragments = Math.max(1, Math.min(BURST_BLOB_CONFIG.maxActive, Math.round(fragments)));
        if (!this.pendingBurstRequest) {
            this.pendingBurstRequest = {
                fragments: targetFragments,
                strength,
                sourceCount,
                origin: origin ? origin.clone() : null,
            };
            return;
        }

        this.pendingBurstRequest.fragments = Math.min(
            BURST_BLOB_CONFIG.maxActive,
            Math.max(this.pendingBurstRequest.fragments, targetFragments),
        );
        this.pendingBurstRequest.strength = Math.max(this.pendingBurstRequest.strength, strength);
        this.pendingBurstRequest.sourceCount = Math.max(this.pendingBurstRequest.sourceCount, sourceCount);
        if (origin) {
            this.pendingBurstRequest.origin = origin.clone();
        }
    }

    flushQueuedBlobBurst() {
        if (!this.pendingBurstRequest || !this.isActive || !this.blobs.length) return;
        if (this.burstBlobs.length === 0) {
            this.scheduleDeferredEffects(0);
            return;
        }

        const {
            fragments,
            strength,
            sourceCount,
            origin,
        } = this.pendingBurstRequest;
        this.pendingBurstRequest = null;

        let qualityMultiplier = 1;
        if (this.activeQualityLevel === 'Minimal') {
            qualityMultiplier = 0.5;
        } else if (this.activeQualityLevel === 'Low') {
            qualityMultiplier = 0.7;
        }

        const targetFragments = Math.max(
            1,
            Math.min(
                BURST_BLOB_CONFIG.maxActive,
                Math.round(fragments * qualityMultiplier),
            ),
        );
        const sources = this.selectBurstSourceBlobs(sourceCount, origin);
        if (!sources.length) return;

        let spawned = 0;
        const perSource = Math.max(1, Math.ceil(targetFragments / sources.length));
        sources.forEach((sourceBlob) => {
            for (let i = 0; i < perSource && spawned < targetFragments; i += 1) {
                this.spawnBurstBlob(sourceBlob, strength, origin);
                spawned += 1;
            }
        });
    }

    initializeAmbientSparkState(geometry, count) {
        const positionAttr = geometry?.getAttribute?.('position');
        const colorAttr = geometry?.getAttribute?.('color');
        if (!positionAttr || !colorAttr) {
            this.ambientSparkState = null;
            return;
        }

        const sizeAttr = geometry.getAttribute('aSize') || geometry.getAttribute('size') || null;
        const baseColors = new Float32Array(colorAttr.array.length);
        const baseSizes = sizeAttr ? new Float32Array(sizeAttr.array.length) : null;
        baseColors.set(colorAttr.array);
        if (baseSizes) baseSizes.set(sizeAttr.array);

        const modes = new Uint8Array(count);
        const bandIndices = new Uint8Array(count);
        const primaryBlobIndices = new Int16Array(count);
        const secondaryBlobIndices = new Int16Array(count);
        const progress = new Float32Array(count);
        const speeds = new Float32Array(count);
        const laterals = new Float32Array(count);
        const depths = new Float32Array(count);
        const phases = new Float32Array(count);
        const adhesion = new Float32Array(count);

        this.ambientSparkState = {
            count,
            positions: positionAttr.array,
            colors: colorAttr.array,
            baseColors,
            sizes: sizeAttr?.array || null,
            baseSizes,
            positionAttr,
            colorAttr,
            sizeAttr,
            modes,
            bandIndices,
            primaryBlobIndices,
            secondaryBlobIndices,
            progress,
            speeds,
            laterals,
            depths,
            phases,
            adhesion,
        };

        for (let i = 0; i < count; i += 1) {
            this.reseedAmbientParticle(this.ambientSparkState, i);
        }
    }

    reseedAmbientParticle(state, index, preserveMode = false) {
        if (!state || index < 0 || index >= state.count) return;

        const modeRandom = Math.random();
        let mode = preserveMode ? state.modes[index] : AMBIENT_PARTICLE_MODES.surface;
        const danger = this.fxState?.dangerLevel || 0;
        const overdrive = this.fxState?.stageState === 'overdrive';
        if (!preserveMode) {
            if (overdrive && modeRandom < 0.18) {
                mode = AMBIENT_PARTICLE_MODES.hero;
            } else if (danger > 0.55 && modeRandom < 0.26) {
                mode = AMBIENT_PARTICLE_MODES.hero;
            } else if (modeRandom < 0.44) {
                mode = AMBIENT_PARTICLE_MODES.surface;
            } else if (modeRandom < 0.64) {
                mode = AMBIENT_PARTICLE_MODES.ambient;
            } else {
                mode = AMBIENT_PARTICLE_MODES.bridge;
            }
        }

        state.modes[index] = mode;
        state.bandIndices[index] = (index + Math.floor(Math.random() * 4)) % 4;
        state.progress[index] = Math.random();
        state.speeds[index] = 0.05 + Math.random() * 0.11;
        state.laterals[index] = Math.random() - 0.5;
        state.depths[index] = Math.random();
        state.phases[index] = Math.random() * Math.PI * 2;
        if (mode === AMBIENT_PARTICLE_MODES.surface) {
            state.adhesion[index] = 0.35 + Math.random() * 0.55;
        } else if (mode === AMBIENT_PARTICLE_MODES.bridge) {
            state.adhesion[index] = 0.2 + Math.random() * 0.4;
        } else if (mode === AMBIENT_PARTICLE_MODES.hero) {
            state.adhesion[index] = 0.08 + Math.random() * 0.24;
        } else {
            state.adhesion[index] = 0;
        }
        state.primaryBlobIndices[index] = this.getRandomAmbientBlobIndex(mode !== AMBIENT_PARTICLE_MODES.ambient);
        state.secondaryBlobIndices[index] = mode === AMBIENT_PARTICLE_MODES.bridge
            ? this.findAmbientBridgePartnerIndex(state.primaryBlobIndices[index])
            : -1;

        if (mode === AMBIENT_PARTICLE_MODES.bridge && state.secondaryBlobIndices[index] < 0) {
            state.modes[index] = AMBIENT_PARTICLE_MODES.surface;
        }
    }

    createMicroGlints() {
        if (!this.scene || this.microGlints || (this.qualityPreset.microGlintCount ?? 0) <= 0) return;

        const count = this.qualityPreset.microGlintCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const laterals = new Float32Array(count);
        const progress = new Float32Array(count);

        for (let i = 0; i < count; i += 1) {
            const color = BLOB_COLORS[(i * 3) % BLOB_COLORS.length];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            sizes[i] = THREE.MathUtils.lerp(MICRO_GLINT_CONFIG.sizeMin, MICRO_GLINT_CONFIG.sizeMax, Math.random());
            phases[i] = Math.random() * Math.PI * 2;
            progress[i] = Math.random();
            laterals[i] = (Math.random() - 0.5) * 2.2;
        }

        const positionAttr = new THREE.BufferAttribute(positions, 3);
        positionAttr.setUsage(THREE.DynamicDrawUsage);
        const colorAttr = new THREE.BufferAttribute(colors, 3);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('color', colorAttr);
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setDrawRange(0, count);

        let material;
        let uniforms;

        if (this.isWebGPU && this.webgpuMaterials?.createMicroGlintsNodeMaterial) {
            const result = this.webgpuMaterials.createMicroGlintsNodeMaterial();
            material = result.material;
            uniforms = result.uniforms;
            this.applyMrtPatchToMaterial(material);
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uHeat: { value: 0 },
                },
                vertexShader: `
                    attribute vec3 color;
                    attribute float size;
                    varying vec3 vColor;
                    uniform float uTime;
                    uniform float uHeat;
                    void main() {
                        vColor = color;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (160.0 / -mvPosition.z) * (0.9 + uHeat * 0.45);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    varying vec3 vColor;
                    void main() {
                        vec2 coord = gl_PointCoord - 0.5;
                        float dist = length(coord);
                        if (dist > 0.5) discard;
                        float glow = pow(1.0 - smoothstep(0.0, 0.5, dist), 4.0);
                        gl_FragColor = vec4(vColor * glow * 1.25, glow * 0.68);
                    }
                `,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                vertexColors: true,
            });
            uniforms = material.uniforms;
        }

        this.microGlints = new THREE.Points(geometry, material);
        this.microGlints.visible = true;
        this.microGlints.frustumCulled = false;
        this.microGlints.renderOrder = 4;
        this.scene.add(this.microGlints);
        this.microGlintState = {
            count,
            positions,
            colors,
            sizes,
            phases,
            laterals,
            progress,
            positionAttr,
            colorAttr,
            uniforms,
        };
        this.applyMicroGlintVisibility();
    }

    destroyMicroGlints() {
        if (!this.microGlints) return;
        this.microGlints.geometry?.dispose?.();
        this.microGlints.material?.dispose?.();
        this.scene?.remove?.(this.microGlints);
        this.microGlints = null;
        this.microGlintState = null;
    }

    updateMicroGlints(delta) {
        const state = this.microGlintState;
        if (!state || !this.microGlints?.visible) return;

        const corridor = this.getStageCorridorBounds();
        const heat = this.fxState.stageHeat;
        const pulse = this.fxState.surgeState * 0.42 + this.fxState.comboPeak * 0.24 + heat * 0.18;
        const accentColor = BLOB_COLORS[(this.fxState.lastComboCount + this.fxState.lastLineCount + 2) % BLOB_COLORS.length];

        for (let i = 0; i < state.count; i += 1) {
            state.progress[i] += delta * (0.03 + heat * 0.04 + (i % 3) * 0.01);
            if (state.progress[i] > 1) state.progress[i] -= 1;

            const spiral = state.progress[i] * Math.PI * 2 + state.phases[i];
            const radius = corridor.width * (0.18 + (i % 5) * 0.03 + heat * 0.04);
            const x = Math.sin(spiral * 1.8) * radius + state.laterals[i];
            const y = Math.cos(spiral) * corridor.height * 0.34 + Math.sin(spiral * 2.2) * 1.4;
            const z = -24 + (i % 7) * 0.8 + Math.sin(spiral * 1.4) * 1.2;
            const idx = i * 3;
            state.positions[idx] = x;
            state.positions[idx + 1] = y;
            state.positions[idx + 2] = z;

            const colorMix = (Math.sin(spiral + this.time * 0.35) * 0.5 + 0.5) * (0.18 + pulse);
            state.colors[idx] = THREE.MathUtils.clamp(BLOB_COLORS[i % BLOB_COLORS.length].r + accentColor.r * colorMix, 0, 1);
            state.colors[idx + 1] = THREE.MathUtils.clamp(BLOB_COLORS[i % BLOB_COLORS.length].g + accentColor.g * colorMix, 0, 1);
            state.colors[idx + 2] = THREE.MathUtils.clamp(BLOB_COLORS[i % BLOB_COLORS.length].b + accentColor.b * colorMix, 0, 1);
        }

        state.uniforms.uTime.value = this.time;
        state.uniforms.uHeat.value = heat;
        state.positionAttr.needsUpdate = true;
        state.colorAttr.needsUpdate = true;
    }

    getAmbientCenterOpenFactor() {
        return this.particleOrchestrator?.getCenterOpenFactor?.(this.fxState, this.conductorChannels)
            ?? 0.06;
    }

    applyAmbientCenterExclusion(point, openness, laneIndex) {
        const corridor = this.getStageCorridorBounds();
        const exclusionStrength = 1 - THREE.MathUtils.clamp(openness, 0, 1);
        if (exclusionStrength <= 0.001) return 0;

        const exclusionHalfWidth = corridor.width * THREE.MathUtils.lerp(0.05, 0.2, exclusionStrength);
        const xDistance = Math.abs(point.x);
        if (xDistance >= exclusionHalfWidth) return 0;

        const normalized = 1 - (xDistance / Math.max(exclusionHalfWidth, 0.0001));
        let side = Math.sign(point.x);
        if (xDistance <= 0.001) {
            side = (laneIndex === 0 || laneIndex === 2) ? -1 : 1;
        }
        const push = normalized * normalized * exclusionHalfWidth * (0.42 + exclusionStrength * 0.76);
        point.x += side * push;
        point.z -= normalized * (1.8 + exclusionStrength * 2.2);
        point.y += Math.sin((this.time * 0.8) + laneIndex) * normalized * exclusionStrength * 0.12;
        return normalized * exclusionStrength;
    }

    applyAmbientImpactCurl(point, flowBias, openness, laneIndex) {
        if (!this.fxState.hasImpactOrigin) return 0;

        this.tmpVec3B.copy(this.fxState.impactOrigin).sub(point);
        const distance = this.tmpVec3B.length();
        if (!Number.isFinite(distance) || distance <= 0.0001) return 0;

        const radius = this.screenBounds.width * THREE.MathUtils.lerp(0.22, 0.5, THREE.MathUtils.clamp(openness, 0, 1));
        const influence = THREE.MathUtils.clamp(
            1 - (distance / Math.max(radius, 0.0001)),
            0,
            1,
        ) * (
            this.fxState.lockImpact * 0.14
            + this.fxState.comboPeak * 0.18
            + this.fxState.surgeState * 0.24
            + this.fxState.lineSurge * 0.12
        );
        if (influence <= 0.0001) return 0;

        this.tmpVec3B.normalize();
        this.tmpVec3C.set(-this.tmpVec3B.y, this.tmpVec3B.x, 0);
        if (this.tmpVec3C.lengthSq() <= 0.0001) {
            this.tmpVec3C.set((laneIndex % 2 === 0 ? -1 : 1), 0.2, 0);
        }
        this.tmpVec3C.normalize();
        if (laneIndex % 2 === 1) {
            this.tmpVec3C.multiplyScalar(-1);
        }

        this.tmpVec3D.set(this.tmpVec3B.y, -this.tmpVec3B.x, 0.12).normalize();
        const curlStrength = influence * (0.9 + flowBias * 0.45) * (1.08 - openness * 0.42);
        const lateralStrength = influence * (0.28 + (1 - openness) * 0.2);
        const radialBias = influence * (openness * 0.12 - 0.06);
        point.addScaledVector(this.tmpVec3C, curlStrength);
        point.addScaledVector(this.tmpVec3D, lateralStrength);
        point.addScaledVector(this.tmpVec3B, radialBias);
        point.z -= influence * (0.8 + (1 - openness) * 1.6);
        return influence;
    }

    sampleAmbientBackgroundPoint(state, index, out, tangentOut) {
        const corridor = this.getStageCorridorBounds();
        const bounds = this.screenBounds;
        const progress = state.progress[index];
        const phase = state.phases[index];
        const lateral = state.laterals[index];
        const depth = state.depths[index];
        const band = state.bandIndices[index] % 4;
        const angle = progress * Math.PI * 2 + phase;

        if (band === 0) {
            out.set(
                THREE.MathUtils.lerp(-bounds.width * 1.08, -corridor.width * 0.18, progress)
                    + Math.sin(angle * 1.18) * bounds.width * 0.06,
                THREE.MathUtils.lerp(corridor.top * 0.92, corridor.top * 0.18, progress)
                    + Math.cos(angle * 1.5 + lateral * 3.0) * bounds.height * 0.07
                    + lateral * 1.2,
                -24 - depth * 6.5 + Math.sin(angle * 1.4) * 1.4,
            );
            tangentOut.set(0.92, -0.18, 0.14).normalize();
            return out;
        }

        if (band === 1) {
            out.set(
                THREE.MathUtils.lerp(bounds.width * 1.08, corridor.width * 0.22, progress)
                    + Math.cos(angle * 1.14) * bounds.width * 0.06,
                THREE.MathUtils.lerp(corridor.bottom * 0.96, corridor.bottom * 0.18, progress)
                    + Math.sin(angle * 1.42 + lateral * 2.4) * bounds.height * 0.07
                    + lateral * 1.18,
                -24.5 - depth * 6.2 + Math.cos(angle * 1.36) * 1.5,
            );
            tangentOut.set(-0.9, 0.18, 0.16).normalize();
            return out;
        }

        if (band === 2) {
            const orbitRadiusX = bounds.width * (0.92 + depth * 0.12);
            const orbitRadiusY = bounds.height * (0.76 + depth * 0.1);
            out.set(
                Math.cos(angle * 0.78) * orbitRadiusX,
                Math.sin(angle * 0.94 + lateral * 1.2) * orbitRadiusY,
                -28 - depth * 8.2 + Math.sin(angle * 1.8) * 1.8,
            );
            tangentOut.set(-Math.sin(angle * 0.78), Math.cos(angle * 0.94), 0.08).normalize();
            return out;
        }

        out.set(
            THREE.MathUtils.lerp(bounds.width * 0.84, -bounds.width * 0.62, progress)
                + Math.sin(angle * 1.32 + lateral * 2.0) * bounds.width * 0.05,
            THREE.MathUtils.lerp(corridor.top * 0.22, corridor.bottom * 0.28, progress)
                + Math.sin(angle * 1.08 + 1.2) * bounds.height * 0.08
                + lateral * 0.9,
            -22.4 - depth * 6.8 + Math.cos(angle * 1.74) * 1.5,
        );
        tangentOut.set(-0.84, -0.08, 0.18).normalize();
        return out;
    }

    sampleAmbientSurfacePoint(state, index, blob, out, tangentOut) {
        if (!blob?.mainMesh?.position) {
            return this.sampleAmbientBackgroundPoint(state, index, out, tangentOut);
        }

        const angle = state.progress[index] * Math.PI * 2 + state.phases[index];
        const depth = state.depths[index];
        const lateral = state.laterals[index];
        const center = blob.mainMesh.position;
        const flow = this.getBlobFlowReference(blob, this.tmpVec3B);
        const worldUp = Math.abs(flow.y) > 0.82
            ? this.tmpVec3C.set(1, 0, 0)
            : this.tmpVec3C.set(0, 1, 0);
        const basisA = this.tmpVec3D.crossVectors(flow, worldUp).normalize();
        const basisB = this.tmpVec3E.crossVectors(flow, basisA).normalize();

        this.tmpVec3F.copy(basisA).multiplyScalar(Math.cos(angle));
        this.tmpVec3F.addScaledVector(
            basisB,
            Math.sin(angle * (0.84 + depth * 0.22) + lateral * 1.8) * (0.72 + depth * 0.2),
        );
        this.tmpVec3F.addScaledVector(flow, Math.sin(angle * 0.52 + lateral * 2.1) * 0.22);
        this.tmpVec3F.normalize();

        const radius = this.getBlobRenderRadius(blob) * THREE.MathUtils.lerp(1.04, 1.3, depth);
        out.copy(center).addScaledVector(this.tmpVec3F, radius);

        tangentOut.copy(flow).projectOnPlane(this.tmpVec3F);
        if (tangentOut.lengthSq() <= 0.0001) {
            tangentOut.crossVectors(this.tmpVec3F, basisA);
        }
        tangentOut.normalize();
        return out;
    }

    sampleAmbientBridgePoint(state, index, blobA, blobB, out, tangentOut) {
        if (!blobA?.mainMesh?.position || !blobB?.mainMesh?.position) {
            return this.sampleAmbientBackgroundPoint(state, index, out, tangentOut);
        }

        const posA = blobA.mainMesh.position;
        const posB = blobB.mainMesh.position;
        const radiusA = this.getBlobRenderRadius(blobA);
        const radiusB = this.getBlobRenderRadius(blobB);
        const combinedRadius = radiusA + radiusB;

        this.tmpVec3A.copy(posB).sub(posA);
        const distance = this.tmpVec3A.length();
        if (!Number.isFinite(distance) || distance <= 0.0001 || distance > combinedRadius * 2.35) {
            return this.sampleAmbientSurfacePoint(state, index, blobA, out, tangentOut);
        }

        this.tmpVec3A.normalize();
        const phase = state.phases[index];
        const progress = state.progress[index];
        const along = 0.16 + progress * 0.68;
        const midpoint = this.tmpVec3B.copy(posA).lerp(posB, 0.5);
        const seamPoint = this.tmpVec3C.copy(posA).lerp(posB, along);
        const outward = this.tmpVec3D.set(midpoint.x, midpoint.y * 0.14, 0.28 + state.depths[index] * 0.5);
        if (outward.lengthSq() <= 0.0001) {
            outward.set(midpoint.x >= 0 ? 1 : -1, 0.12, 0.26);
        }
        outward.normalize();

        seamPoint.addScaledVector(
            outward,
            combinedRadius * 0.14 + Math.sin(progress * Math.PI * 2 + phase) * combinedRadius * 0.04,
        );
        seamPoint.addScaledVector(this.tmpVec3A, Math.sin(progress * Math.PI * 4 + phase) * distance * 0.08);

        out.copy(seamPoint);
        tangentOut.copy(this.tmpVec3A).lerp(outward, 0.22).normalize();
        return out;
    }

    sampleAmbientHeroPoint(state, index, out, tangentOut) {
        const corridor = this.getStageCorridorBounds();
        const progress = state.progress[index];
        const phase = state.phases[index];
        const lateral = state.laterals[index];
        const depth = state.depths[index];
        const orbitAngle = progress * Math.PI * 2 + phase;
        const orbitRadiusX = corridor.width * (0.16 + depth * 0.08);
        const orbitRadiusY = corridor.height * (0.1 + depth * 0.05);
        const focusY = this.fxState.lineBandY || 0;
        const dangerLift = this.fxState.dangerLevel || 0;

        out.set(
            Math.sin(orbitAngle * 1.18) * orbitRadiusX + lateral * corridor.width * 0.05,
            focusY * 0.68 + Math.cos(orbitAngle * 1.42 + lateral * 2.4) * orbitRadiusY + dangerLift * corridor.height * 0.18,
            -6.8 - depth * 3.4 + Math.sin(orbitAngle * 2.4) * 0.72,
        );
        tangentOut.set(Math.cos(orbitAngle * 1.18), -Math.sin(orbitAngle * 1.42), 0.3).normalize();
        return out;
    }

    getAmbientLanePoint(laneIndex, progress, lateral, depth, out) {
        const corridor = this.getStageCorridorBounds();
        const stageHeat = this.fxState?.stageHeat ?? 0;
        const width = corridor.width * (0.72 + stageHeat * 0.1);
        const height = corridor.height * (0.64 + stageHeat * 0.07);
        const progressAngle = progress * Math.PI * 2.0;

        if (laneIndex === 0) {
            out.set(
                THREE.MathUtils.lerp(-width * 1.02, width * 0.22, progress)
                    + Math.sin(progressAngle * 1.2 + lateral * 2.4) * width * 0.05,
                THREE.MathUtils.lerp(corridor.top * 0.74, corridor.top * 0.04, progress)
                    + Math.sin(progressAngle * 1.65 + lateral * 3.2) * height * 0.08
                    + lateral * 1.12,
                -18.5 - depth * 4.2 + Math.cos(progressAngle * 1.4) * (1.5 + stageHeat * 0.45),
            );
            return out;
        }

        if (laneIndex === 1) {
            out.set(
                THREE.MathUtils.lerp(width * 1.04, -width * 0.24, progress)
                    + Math.cos(progressAngle * 1.16 + 0.5 + lateral * 2.1) * width * 0.05,
                THREE.MathUtils.lerp(corridor.bottom * 0.76, corridor.bottom * 0.02, progress)
                    + Math.cos(progressAngle * 1.52 + lateral * 2.6) * height * 0.07
                    + lateral * 1.16,
                -18.2 - depth * 4.8 + Math.sin(progressAngle * 1.34 + 0.6) * (1.6 + stageHeat * 0.42),
            );
            return out;
        }

        if (laneIndex === 2) {
            const orbitRadiusX = width * (0.82 + depth * 0.16);
            const orbitRadiusY = height * (0.72 + depth * 0.12);
            out.set(
                Math.cos(progressAngle + lateral * 1.4) * orbitRadiusX,
                Math.sin(progressAngle * 1.08 + lateral * 0.9) * orbitRadiusY * 0.7,
                -24.5 - depth * 5.4 + Math.sin(progressAngle * 2.2 + lateral * 2.0) * (1.6 + stageHeat * 0.6),
            );
            return out;
        }

        out.set(
            THREE.MathUtils.lerp(width * 0.58, -width * 0.54, progress)
                + Math.sin(progressAngle * 1.4 + lateral * 1.8) * width * 0.06,
            THREE.MathUtils.lerp(corridor.top * 0.34, corridor.bottom * 0.3, progress)
                + Math.sin(progressAngle * 1.2 + 1.1) * height * 0.09
                + lateral * 1.0,
            -20.8 - depth * 5.2 + Math.cos(progressAngle * 2.0 + lateral * 2.0) * (1.8 + stageHeat * 0.55),
        );
        return out;
    }

    createGameplaySparkBurstResource(poolIndex = 0) {
        if (!this.scene) return null;

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(GAMEPLAY_SPARK_CONFIG.maxParticlesPerBurst * 3);
        const colors = new Float32Array(GAMEPLAY_SPARK_CONFIG.maxParticlesPerBurst * 3);
        const velocities = new Float32Array(GAMEPLAY_SPARK_CONFIG.maxParticlesPerBurst * 3);
        const baseColor = BLOB_COLORS[poolIndex % BLOB_COLORS.length];

        for (let j = 0; j < GAMEPLAY_SPARK_CONFIG.maxParticlesPerBurst; j += 1) {
            colors[j * 3] = baseColor.r;
            colors[j * 3 + 1] = baseColor.g;
            colors[j * 3 + 2] = baseColor.b;
        }

        const positionAttr = new THREE.BufferAttribute(positions, 3);
        positionAttr.setUsage(THREE.DynamicDrawUsage);
        const colorAttr = new THREE.BufferAttribute(colors, 3);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('color', colorAttr);
        geometry.setDrawRange(0, 0);

        const material = new THREE.PointsMaterial({
            size: 0.5,
            transparent: true,
            opacity: 0,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });
        const points = new THREE.Points(geometry, material);
        points.visible = false;
        points.frustumCulled = false;
        points.renderOrder = 3;
        this.scene.add(points);

        return {
            active: false,
            age: 0,
            life: 0.6,
            intensity: 1,
            count: 0,
            baseSize: 0.5,
            opacity: 1,
            pattern: 'lock',
            origin: new THREE.Vector3(),
            positions,
            colors,
            velocities,
            geometry,
            positionAttr,
            colorAttr,
            material,
            points,
        };
    }

    initializeGameplaySparkPools() {
        if (!this.scene || this.gameplaySparkBursts.length > 0) return;

        const initialPoolSize = Math.min(3, GAMEPLAY_SPARK_CONFIG.poolSize);
        for (let i = 0; i < initialPoolSize; i += 1) {
            const burst = this.createGameplaySparkBurstResource(i);
            if (burst) this.gameplaySparkBursts.push(burst);
        }
    }

    acquireGameplaySparkBurst() {
        const inactive = this.gameplaySparkBursts.find((burst) => burst.active !== true);
        if (inactive) return inactive;

        if (this.gameplaySparkBursts.length < GAMEPLAY_SPARK_CONFIG.poolSize) {
            const burst = this.createGameplaySparkBurstResource(this.gameplaySparkBursts.length);
            if (burst) {
                this.gameplaySparkBursts.push(burst);
                return burst;
            }
        }

        return this.gameplaySparkBursts.reduce((oldest, candidate) => {
            if (!oldest) return candidate;
            return candidate.age > oldest.age ? candidate : oldest;
        }, null);
    }

    deactivateGameplaySparkBurst(burst) {
        if (!burst) return;
        burst.active = false;
        burst.age = 0;
        burst.count = 0;
        burst.points.visible = false;
        burst.material.opacity = 0;
        burst.geometry.setDrawRange(0, 0);
    }

    destroyGameplaySparkBurstResources(burst) {
        if (!burst) return;
        burst.geometry?.dispose?.();
        burst.material?.dispose?.();
        this.scene?.remove?.(burst.points);
    }

    spawnGameplaySparkBurst(options = {}) {
        if (!this.scene || !this.gameplaySparkBursts.length) return;

        // Per-frame burst cap: combo events can trigger 3-4 bursts at once.
        // Doing all of them in one frame causes a visible spike (CPU init +
        // multiple GPU buffer uploads). Anything past the cap gets queued and
        // drained one-per-frame in the animate loop — invisible (~16ms delay).
        // Caller's options are kept by ref; queue holds references not copies.
        if (this._burstsThisFrame >= GAMEPLAY_SPARK_CONFIG.maxNewBurstsPerFrame) {
            // Cap the queue to avoid unbounded growth on extreme combo cascades.
            if (this._burstQueue.length < 8) this._burstQueue.push(options);
            return;
        }
        this._burstsThisFrame += 1;

        // Global concurrent spark particle budget — skip if over limit
        let activeSparkCount = 0;
        for (let b = 0; b < this.gameplaySparkBursts.length; b++) {
            if (this.gameplaySparkBursts[b].active) activeSparkCount += this.gameplaySparkBursts[b].count;
        }
        const sparkBudgetRemaining = Math.max(0, 600 - activeSparkCount);
        if (sparkBudgetRemaining <= 0) return;

        const burst = this.acquireGameplaySparkBurst();
        if (!burst) return;

        const {
            origin,
            count = GAMEPLAY_SPARK_CONFIG.lockMin,
            life = 0.55,
            intensity = 1,
            size = 0.5,
            palette = [BLOB_COLORS[0], BLOB_COLORS[1]],
            direction = null,
            pattern = 'lock',
        } = options;

        const resolvedOrigin = origin || this.getComboOrigin();
        const clampedCount = Math.max(4, Math.min(sparkBudgetRemaining, Math.min(GAMEPLAY_SPARK_CONFIG.maxParticlesPerBurst, Math.round(count))));
        const primaryDirection = direction
            ? this.tmpVec3A.copy(direction).normalize()
            : this.tmpVec3A.copy(this.fxState.impactDirection).normalize();

        burst.active = true;
        burst.age = 0;
        burst.life = life;
        burst.count = clampedCount;
        burst.baseSize = size;
        burst.opacity = THREE.MathUtils.clamp(0.82 + intensity * 0.2, 0.78, 1);
        burst.pattern = pattern;
        if (!burst.origin) burst.origin = new THREE.Vector3();
        burst.origin.copy(resolvedOrigin);

        for (let i = 0; i < clampedCount; i += 1) {
            const color = palette[i % palette.length];
            const offset = this.tmpVec3B.set(
                (Math.random() - 0.5) * 0.45,
                (Math.random() - 0.5) * 0.45,
                (Math.random() - 0.5) * 0.32,
            );
            const dir = this.tmpVec3C.set(
                primaryDirection.x + (Math.random() - 0.5) * 0.65,
                primaryDirection.y + (Math.random() - 0.5) * 0.65,
                primaryDirection.z + 0.2 + Math.random() * 0.55,
            ).normalize();
            let speedBase = 8.1;
            if (pattern === 'line') {
                speedBase = 9.4;
            } else if (pattern === 'combo') {
                speedBase = 11.8;
            }
            const speed = speedBase + Math.random() * 4.8 + intensity * 2.1;

            const idx = i * 3;
            burst.positions[idx] = resolvedOrigin.x + offset.x;
            burst.positions[idx + 1] = resolvedOrigin.y + offset.y;
            burst.positions[idx + 2] = resolvedOrigin.z + offset.z;
            burst.velocities[idx] = dir.x * speed + (pattern === 'line' ? (Math.random() - 0.5) * 5.5 : 0);
            burst.velocities[idx + 1] = dir.y * speed + (pattern === 'lock' ? 1.6 : 0.6);
            burst.velocities[idx + 2] = dir.z * (speed + 5.2);
            burst.colors[idx] = color.r;
            burst.colors[idx + 1] = color.g;
            burst.colors[idx + 2] = color.b;
        }

        burst.points.visible = true;
        burst.material.opacity = burst.opacity;
        burst.material.size = size;
        burst.geometry.setDrawRange(0, clampedCount);
        // Partial upload: only the slice we actually wrote needs to go to GPU.
        // Default needsUpdate=true uploads the full buffer; for a 480-slot buffer
        // writing 80 particles, that's a 6× upload reduction. Per-frame combo
        // events benefit most since they typically use small sub-ranges.
        const writtenFloats = clampedCount * 3;
        burst.positionAttr.updateRange = { offset: 0, count: writtenFloats };
        burst.colorAttr.updateRange = { offset: 0, count: writtenFloats };
        burst.positionAttr.needsUpdate = true;
        burst.colorAttr.needsUpdate = true;
    }

    updateGameplaySparkBursts(delta) {
        if (!this.gameplaySparkBursts.length) return;

        const drag = GAMEPLAY_SPARK_CONFIG.drag ** (delta * 60);
        for (let i = 0; i < this.gameplaySparkBursts.length; i += 1) {
            const burst = this.gameplaySparkBursts[i];
            if (!burst.active) continue;

            burst.age += delta;
            const lifeT = burst.age / Math.max(burst.life, 0.0001);
            if (lifeT >= 1) {
                this.deactivateGameplaySparkBurst(burst);
                continue;
            }

            const fade = 1 - lifeT;
            for (let j = 0; j < burst.count; j += 1) {
                const idx = j * 3;
                burst.velocities[idx] *= drag;
                burst.velocities[idx + 1] *= drag;
                burst.velocities[idx + 2] *= drag;
                burst.velocities[idx + 2] += GAMEPLAY_SPARK_CONFIG.zAcceleration * delta * 0.4;
                burst.positions[idx] += burst.velocities[idx] * delta;
                burst.positions[idx + 1] += burst.velocities[idx + 1] * delta;
                burst.positions[idx + 2] += burst.velocities[idx + 2] * delta;
            }

            burst.material.opacity = burst.opacity * fade * fade;
            burst.material.size = burst.baseSize * (0.95 + (1 - fade) * 0.45);
            burst.positionAttr.needsUpdate = true;
        }
    }

    initializeLineWakePool() {
        if (!this.scene || this.lineWakes.length > 0) return;

        const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
        const initialPoolSize = Math.min(4, LINE_WAKE_CONFIG.poolSize);
        for (let i = 0; i < initialPoolSize; i += 1) {
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.frustumCulled = false;
            mesh.renderOrder = 2;
            mesh.position.z = 1.4;
            this.scene.add(mesh);

            this.lineWakes.push({
                active: false,
                age: 0,
                life: LINE_WAKE_CONFIG.baseLife,
                intensity: 1,
                y: 0,
                height: 0.2,
                baseColor: new THREE.Color(0xffffff),
                mesh,
                material,
            });
        }
    }

    acquireLineWake() {
        const inactive = this.lineWakes.find((wake) => wake.active !== true);
        if (inactive) return inactive;

        if (this.lineWakes.length < LINE_WAKE_CONFIG.poolSize && this.scene) {
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(this.lineWakes[0]?.mesh?.geometry || new THREE.PlaneGeometry(1, 1, 1, 1), material);
            mesh.visible = false;
            mesh.frustumCulled = false;
            mesh.renderOrder = 2;
            mesh.position.z = 1.4;
            this.scene.add(mesh);
            const wake = {
                active: false,
                age: 0,
                life: LINE_WAKE_CONFIG.baseLife,
                intensity: 1,
                y: 0,
                height: 0.2,
                baseColor: new THREE.Color(0xffffff),
                mesh,
                material,
            };
            this.lineWakes.push(wake);
            return wake;
        }

        return this.lineWakes.reduce((oldest, candidate) => {
            if (!oldest) return candidate;
            return candidate.age > oldest.age ? candidate : oldest;
        }, null);
    }

    deactivateLineWake(wake) {
        if (!wake) return;
        wake.active = false;
        wake.age = 0;
        wake.mesh.visible = false;
        wake.material.opacity = 0;
    }

    destroyLineWakeResources(wake) {
        if (!wake) return;
        if (wake.mesh?.geometry && wake.mesh.geometry !== this.lineWakes[0]?.mesh?.geometry) {
            wake.mesh.geometry.dispose();
        }
        wake.material?.dispose?.();
        this.scene?.remove?.(wake.mesh);
    }

    spawnLineWake(options = {}) {
        if (!this.scene || !this.lineWakes.length) return;

        const wake = this.acquireLineWake();
        if (!wake) return;

        wake.active = true;
        wake.age = 0;
        wake.life = options.life ?? LINE_WAKE_CONFIG.baseLife;
        wake.intensity = options.intensity ?? 1;
        wake.y = options.y ?? 0;
        wake.height = options.height ?? 0.2;
        wake.baseColor.copy(options.color || this.getColorFromValue('#8a8dff', 0x8a8dff));
        wake.waveBias = options.waveBias ?? (this.fxState.rewardPulse || 0);
        wake.mesh.visible = true;
        wake.mesh.position.set(0, wake.y, 1.4);
        wake.mesh.scale.set(this.getStageCorridorBounds().width * 0.72, wake.height * 2.4, 1);
        wake.material.color.copy(wake.baseColor);
        wake.material.opacity = LINE_WAKE_CONFIG.baseOpacity * wake.intensity;
    }

    updateLineWakes(delta) {
        if (!this.lineWakes.length) return;

        const corridor = this.getStageCorridorBounds();
        for (let i = 0; i < this.lineWakes.length; i += 1) {
            const wake = this.lineWakes[i];
            if (!wake.active) continue;

            wake.age += delta;
            const lifeT = wake.age / Math.max(wake.life, 0.0001);
            if (lifeT >= 1) {
                this.deactivateLineWake(wake);
                continue;
            }

            const fade = 1 - lifeT;
            const dangerLevel = this.fxState.dangerLevel || 0;
            wake.mesh.position.y = wake.y;
            wake.mesh.position.z = 1.4 + lifeT * 5.4;
            wake.mesh.scale.set(
                corridor.width * (0.72 + lifeT * (1.08 + wake.waveBias * 0.34)),
                wake.height * (2.4 + lifeT * (6.0 + wake.waveBias * 1.2 + dangerLevel * 0.8)),
                1,
            );
            wake.material.opacity = LINE_WAKE_CONFIG.baseOpacity * wake.intensity * fade * fade;
            wake.material.color.copy(wake.baseColor)
                .lerp(this.tmpColorA.set(0xffffff), 0.03 + lifeT * 0.06 + wake.waveBias * 0.05)
                .lerp(this.tmpColorB.set(0xff8450), dangerLevel * 0.08);
        }
    }

    updateBurstBlobs(delta) {
        if (!this.burstBlobs.length) return;

        const drag = BURST_BLOB_CONFIG.drag ** (delta * 60);
        for (let i = 0; i < this.burstBlobs.length; i += 1) {
            const burstBlob = this.burstBlobs[i];
            if (!burstBlob.active) continue;

            burstBlob.age += delta;
            const lifeT = burstBlob.age / burstBlob.life;

            if (lifeT >= 1 || burstBlob.position.z > this.camera.position.z - 6) {
                this.deactivateBurstBlob(burstBlob);
                continue;
            }

            const fade = 1 - lifeT;
            burstBlob.velocity.multiplyScalar(drag);
            burstBlob.velocity.z += BURST_BLOB_CONFIG.zAcceleration * delta * (0.8 + burstBlob.strength * 0.4);
            burstBlob.position.addScaledVector(burstBlob.velocity, delta);

            const burstScale = burstBlob.baseScale
                * (1 + lifeT * 0.48)
                * (0.94 + Math.sin((this.time * 6) + burstBlob.phase) * 0.04);

            const deltaMul60 = delta * 60;
            for (let m = 0; m < burstBlob.meshes.length; m++) {
                const mesh = burstBlob.meshes[m];
                mesh.position.copy(burstBlob.position);
                const scaleMultiplier = mesh.userData?.baseScaleMultiplier ?? 1;
                mesh.scale.setScalar(burstScale * scaleMultiplier);
                mesh.rotation.x += burstBlob.angularVelocity.x * deltaMul60;
                mesh.rotation.y += burstBlob.angularVelocity.y * deltaMul60;
                mesh.rotation.z += burstBlob.angularVelocity.z * deltaMul60;
            }

            if (burstBlob.mainUniforms) {
                burstBlob.mainUniforms.uTime.value = this.time + burstBlob.phase;
                burstBlob.mainUniforms.uColor.value.copy(burstBlob.color);
                burstBlob.mainUniforms.uPulseIntensity.value = 0.32 + burstBlob.strength * 0.42 + fade * 0.16;
                burstBlob.mainUniforms.uMorphFactor.value = 0.38 + burstBlob.strength * 0.22 + fade * 0.18;
                if (burstBlob.mainUniforms.uOpacity) {
                    burstBlob.mainUniforms.uOpacity.value = Math.max(0, fade * 0.78);
                }
            } else if (burstBlob.mainMesh?.material) {
                burstBlob.mainMesh.material.opacity = 0.72 * fade;
            }

            if (burstBlob.glowUniforms) {
                burstBlob.glowUniforms.uTime.value = this.time + burstBlob.phase;
                burstBlob.glowUniforms.uColor.value.copy(burstBlob.color);
                burstBlob.glowUniforms.uGlowIntensity.value = 0.2 + burstBlob.strength * 0.22 + fade * 0.16;
                if (burstBlob.glowUniforms.uOpacity) {
                    burstBlob.glowUniforms.uOpacity.value = Math.max(0, fade * 0.78);
                }
            } else if (burstBlob.glowMesh?.material) {
                burstBlob.glowMesh.material.opacity = 0.2 * fade;
            }
        }
    }

    async createScene() {
        if (typeof document === 'undefined') return;

        this.applyQualityPreset(this.getCurrentQualityLevel());
        this.ensureStageSystems();
        this.initializeAdaptiveBudgetState();
        this.resetPerformanceTelemetry();
        this.postFallbackPending = false;
        this.computeFallbackPending = false;
        this.hasRetriedPostWithoutMrt = false;
        this.postProfile = null;
        this.burstPoolPrewarmed = false;
        this.burstPoolPrewarmScheduled = false;
        this.burstPoolPrewarmPromise = null;
        this.deferredEffectsScheduled = false;
        this.deferredEffectsPromise = null;
        this.postSetupRetryScheduled = false;
        this.pendingBurstRequest = null;
        this.gameplaySparkBursts = [];
        this.lineWakes = [];
        this.ambientSparkState = null;
        this.boardHaloState = null;
        this.microGlints = null;
        this.microGlintState = null;
        this.destroyHeroParticles();
        this.blobTierCounts = {
            hero: 0,
            support: 0,
            ghost: 0,
        };
        this.resetFxController();

        // Reset progressive & tiered deferred loading state
        this.pendingBlobQueue = [];
        this.blobLoadingComplete = false;
        this.frameCount = 0;
        this.deferredTier1Done = false;
        this.deferredTier2Done = false;
        this.deferredTier3Done = false;
        this.backgroundNeedsUpgrade = false;

        this.primeModuleImports();

        const container = document.getElementById('electric-dreams-theme');
        if (!container) {
            console.error('[ElectricDreams] Container not found');
            return;
        }

        await this.initRenderer(container);
        if (!this.renderer || !this.scene || !this.camera) return;

        this.createBackground();
        this.createBoardHalo();
        this.createInitialBlobs();
        this.setupLighting();
        this.setupEventListeners();
        this.registerDebugHelpers();

        console.log(
            `[ElectricDreams] Scene created (${this.isWebGPU ? 'WebGPU' : 'WebGL'}) with ${this.blobs.length} blobs (+${this.pendingBlobQueue.length} queued)`,
        );
        this.startAnimation();
        this.scheduleDeferredEffects(0);
        this.queueBackgroundTask(() => this.precompileScene(), 140, { idle: true, timeout: 1600 });
        this.scheduleBurstPoolPrewarm();
    }

    async precompileScene() {
        if (!this.renderer || !this.scene || !this.camera) return;
        if (typeof this.renderer.compileAsync !== 'function') return;

        // Temporarily hide background mesh — it starts as a WebGL ShaderMaterial
        // (upgraded to TSL node material in deferred tier 1) and is incompatible
        // with WebGPU compileAsync before that upgrade happens.
        const bgWasVisible = this.backgroundMesh?.visible;
        if (this.backgroundMesh) this.backgroundMesh.visible = false;

        try {
            await Promise.race([
                this.renderer.compileAsync(this.scene, this.camera),
                new Promise((_, reject) => setTimeout(() => reject(new Error('compile timeout')), 1200)),
            ]);
        } catch (err) {
            console.warn('[ElectricDreams] Scene precompile skipped:', err.message);
        }

        if (this.backgroundMesh && bgWasVisible !== undefined) this.backgroundMesh.visible = bgWasVisible;
    }

    async initRenderer(container) {
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.isWebGPU = false;
        this.isWebGL = false;
        this.capabilities = {
            webgpu: false,
            webgl: false,
            supportsPost: false,
            supportsMRT: false,
            supportsCompute: false,
        };

        // Try WebGPU first
        if (!this.flags.forceWebGL && navigator.gpu) {
            try {
                const THREE_WEBGPU = this.modulePreloads.webgpu
                    ? await this.modulePreloads.webgpu
                    : THREE_WEBGPU;
                const renderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                });
                await Promise.race([
                    renderer.init(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('WebGPU init timeout')), 1800)),
                ]);
                if (renderer.backend?.isWebGPUBackend === true) {
                    this.renderer = renderer;
                    this.isWebGPU = true;
                    this.capabilities.webgpu = true;
                    this.capabilities.supportsPost = true;
                    this.capabilities.supportsMRT = (renderer.capabilities?.maxColorAttachments ?? 8) > 1;
                    this.capabilities.supportsCompute = typeof renderer.compute === 'function';
                } else {
                    renderer.dispose();
                    renderer.forceContextLoss?.();
                    renderer.domElement?.remove?.();
                }
            } catch (error) {
                console.warn('[ElectricDreams] WebGPU init failed, using WebGL fallback:', error);
            }
        }

        // WebGL fallback
        if (!this.renderer) {
            try {
                this.renderer = new THREE.WebGLRenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                    powerPreference: 'high-performance',
                });
                this.isWebGL = true;
                this.capabilities.webgl = true;
                this.capabilities.supportsPost = true;
                this.capabilities.supportsMRT = false;
                this.capabilities.supportsCompute = false;
            } catch (error) {
                console.error('[ElectricDreams] WebGL init failed:', error);
                return;
            }
        }

        // Compute flags
        this.flags.usePost = this.capabilities.supportsPost
            && this.qualityPreset.enablePost === true && !this.flags.noPost;
        this.flags.useMRT = this.capabilities.supportsMRT
            && this.qualityPreset.enableMRT === true && !this.flags.noMRT;
        this.flags.useCompute = this.capabilities.supportsCompute
            && this.qualityPreset.enableCompute === true && !this.flags.noCompute;

        this.updateRendererSurfaceSize(w, h);
        this.renderer.setPixelRatio(this.getRendererPixelRatio());
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        if (!this.isWebGPU) {
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.2;
        }
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0a0015, 0.002);

        this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
        this.camera.position.set(0, 0, 50);
        this.camera.lookAt(0, 0, 0);
        this.baseCameraPosition.set(0, 0, 50);
        this.baseCameraLookAt.set(0, 0, 0);
        this.baseCameraFov = this.camera.fov;

        this.screenBounds = this.calculateScreenBounds();
        this.lastRendererWidth = w;
        this.lastRendererHeight = h;
        this.lastRendererPixelRatio = this.renderer.getPixelRatio?.() || 1;

        // Lazy-load WebGPU modules
        if (this.isWebGPU) {
            try {
                const materialsModule = this.modulePreloads.webgpuMaterials
                    ? await this.modulePreloads.webgpuMaterials
                    : ElectricDreamsMaterials;
                this.webgpuMaterials = materialsModule;
            } catch (error) {
                console.warn('[ElectricDreams] Failed to load WebGPU materials:', error);
            }
        }
    }

    isNodeMaterial(material) {
        if (!material) return false;
        if (material.isNodeMaterial) return true;
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    applyMrtPatchToMaterial(material) {
        if (!this.isWebGPU || !this.flags.useMRT || !material) return true;

        const materials = Array.isArray(material) ? material : [material];
        const zeroEmissive = vec3(0.0);

        for (let i = 0; i < materials.length; i += 1) {
            const entry = materials[i];
            if (!entry || !this.isNodeMaterial(entry)) {
                return false;
            }
        }

        materials.forEach((entry) => {
            if (!entry.userData) entry.userData = {};
            if (!entry.emissiveNode) {
                entry.emissiveNode = zeroEmissive;
                entry.userData.emitsBloom = false;
            }
            entry.mrtNode = mrt({ emissive: entry.emissiveNode || zeroEmissive });
            entry.needsUpdate = true;
        });

        return true;
    }

    clearSceneMrtNodes() {
        if (!this.scene) return;

        const visited = new Set();
        const clearMaterial = (material) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach(clearMaterial);
                return;
            }
            if (visited.has(material) || !this.isNodeMaterial(material)) return;
            visited.add(material);
            material.mrtNode = null;
            material.needsUpdate = true;
        };

        this.scene.traverse((child) => {
            if (child.material) clearMaterial(child.material);
        });
    }

    auditSceneMrtReadiness() {
        if (!this.isWebGPU || !this.scene || !this.flags.useMRT) return true;

        const visited = new Set();
        const nonNodeMaterials = [];

        this.scene.traverse((child) => {
            if (!child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (!material || visited.has(material)) return;
                visited.add(material);
                if (!this.isNodeMaterial(material)) {
                    nonNodeMaterials.push(material.type || material.constructor?.name || 'UnknownMaterial');
                    return;
                }
                this.applyMrtPatchToMaterial(material);
            });
        });

        if (nonNodeMaterials.length > 0) {
            console.warn('[ElectricDreams] MRT audit found non-node materials, disabling MRT:', nonNodeMaterials);
            return false;
        }

        return true;
    }

    auditScenePostReadiness() {
        if (!this.isWebGPU || !this.scene) return { ready: true, offenders: [] };

        if (this.backgroundNeedsUpgrade) {
            return { ready: false, offenders: ['background-upgrade-pending'] };
        }

        const visited = new Set();
        const offenders = [];

        this.scene.traverse((child) => {
            if (!child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
                if (!material || visited.has(material)) return;
                visited.add(material);
                if (!this.isNodeMaterial(material)) {
                    offenders.push(material.type || material.constructor?.name || 'UnknownMaterial');
                }
            });
        });

        return {
            ready: offenders.length === 0,
            offenders,
        };
    }

    deferPostSetupRetry(reason = 'scene-not-ready', delayMs = 120) {
        if (!this.isActive || !this.flags.usePost || this.postPipeline || this.composer || this.postSetupRetryScheduled) return;

        this.postSetupRetryScheduled = true;
        this.queueBackgroundTask(async () => {
            this.postSetupRetryScheduled = false;
            if (!this.isActive || !this.flags.usePost || this.postPipeline || this.composer) return;
            try {
                await this.setupPostProcessing();
            } catch (error) {
                console.warn(`[ElectricDreams] Deferred post retry failed: ${reason}`, error);
            }
        }, delayMs, { idle: true, timeout: 1200 });
    }

    disableMrtRuntime(reason, details = null) {
        if (!this.isWebGPU || this.flags.useMRT !== true) return false;

        this.flags.useMRT = false;
        this.clearSceneMrtNodes();
        console.warn(`[ElectricDreams] Disabling MRT: ${reason}`, details);
        return true;
    }

    disposePostProcessingStack() {
        if (this.postPipeline) {
            this.postPipeline.dispose();
            this.postPipeline = null;
        }
        if (this.composer) {
            this.composer.dispose();
            this.composer = null;
        }
        this.bloomPass = null;
        this.lastAdaptivePostParams = null;
    }

    async rebuildPostProcessingWithoutMrt(reason, error) {
        if (this.postFallbackPending) return;

        this.postFallbackPending = true;
        this.disableMrtRuntime(reason, error);
        this.disposePostProcessingStack();

        try {
            await this.setupPostProcessing();
        } catch (rebuildError) {
            console.warn(
                '[ElectricDreams] Failed to rebuild post-processing without MRT, disabling post path:',
                rebuildError,
            );
            this.flags.usePost = false;
            this.disposePostProcessingStack();
        } finally {
            this.postFallbackPending = false;
        }
    }

    handlePostRenderFailure(error) {
        if (this.isWebGPU && this.flags.useMRT && !this.hasRetriedPostWithoutMrt) {
            this.hasRetriedPostWithoutMrt = true;
            console.warn('[ElectricDreams] WebGPU post render failed, retrying without MRT:', error);
            this.rebuildPostProcessingWithoutMrt('post-render-failed', error).catch((rebuildError) => {
                console.warn('[ElectricDreams] Post fallback rebuild failed:', rebuildError);
            });
            return;
        }

        console.warn('[ElectricDreams] Post render failed, disabling post path:', error);
        this.flags.usePost = false;
        this.disposePostProcessingStack();
    }

    calculateScreenBounds() {
        const vFov = (this.camera.fov * Math.PI) / 180;
        const height = 2 * Math.tan(vFov / 2) * this.camera.position.z;
        const width = height * this.camera.aspect;
        return { width: width * 0.55, height: height * 0.55 };
    }

    resetFxController() {
        this.fxState = createFxState();
        this.ensureStageSystems();
        this.stageConductor?.reset?.();
        this.stageConductor?.syncTrackMeta?.(true);
        this.boardHaloController?.reset?.();
        this.conductorChannels = this.stageConductor?.channels || this.conductorChannels;
    }

    getStageCorridorBounds() {
        return {
            width: this.screenBounds.width * 0.88,
            height: this.screenBounds.height * 1.22,
            top: this.screenBounds.height * 0.62,
            bottom: -this.screenBounds.height * 0.64,
        };
    }

    getBlobTier(index) {
        const tierCounts = this.qualityPreset.tierCounts || {};
        const heroCount = tierCounts.hero || 0;
        const supportCount = tierCounts.support || 0;
        if (index < heroCount) return 'hero';
        if (index < heroCount + supportCount) return 'support';
        return 'ghost';
    }

    getBlobTierLayout(tier, index) {
        const layouts = BLOB_STAGE_LAYOUTS[tier] || BLOB_STAGE_LAYOUTS.ghost;
        return layouts[index % layouts.length];
    }

    buildBlobAnchor(index, tier, tierIndex) {
        const layout = this.getBlobTierLayout(tier, tierIndex);
        const corridor = this.getStageCorridorBounds();
        let jitterScale = 0.038;
        if (tier === 'hero') {
            jitterScale = 0.018;
        } else if (tier === 'support') {
            jitterScale = 0.028;
        } else if (tier === 'ghost') {
            jitterScale = 0.024;
        }
        const jitterX = (Math.random() - 0.5) * this.screenBounds.width * jitterScale;
        const jitterY = (Math.random() - 0.5) * this.screenBounds.height * jitterScale;
        const jitterZ = (Math.random() - 0.5) * (tier === 'ghost' ? 2.4 : 1.2);
        const scale = THREE.MathUtils.lerp(layout.scaleMin, layout.scaleMax, Math.random());
        let heroWeight = 0.72;
        if (tier === 'hero') {
            heroWeight = 1.18;
        } else if (tier === 'support') {
            heroWeight = 0.94;
        }

        const position = new THREE.Vector3(
            layout.x * corridor.width + jitterX,
            layout.y * corridor.height + jitterY,
            layout.z + jitterZ,
        );
        const hotPosition = new THREE.Vector3(
            position.x + (layout.invasionX || 0) * corridor.width,
            position.y + (layout.invasionY || 0) * corridor.height,
            position.z + (layout.invasionZ || 0),
        );
        const heatScale = layout.heatScale || 1.08;

        let stageWeight = 0.48;
        if (tier === 'hero') {
            stageWeight = 1;
        } else if (tier === 'support') {
            stageWeight = 0.76;
        }

        return {
            scale,
            hotScale: scale * heatScale,
            position,
            hotPosition,
            driftScale: layout.drift,
            heroWeight,
            stageWeight,
        };
    }

    mapBoardPointToStage(boardX, boardY, z = 0) {
        const corridor = this.getStageCorridorBounds();
        const clampedX = THREE.MathUtils.clamp(boardX, -0.5, 9.5);
        const clampedY = THREE.MathUtils.clamp(boardY, -1.5, 20.5);
        const normalizedX = clampedX / 9;
        const normalizedY = (clampedY + 1.5) / 22;
        const x = THREE.MathUtils.lerp(-corridor.width * 0.32, corridor.width * 0.32, normalizedX);
        const y = THREE.MathUtils.lerp(corridor.top, corridor.bottom, normalizedY);
        return this.tmpVec3A.set(x, y, z);
    }

    getStageOriginFromScreenPosition(position) {
        if (
            !position
            || typeof window === 'undefined'
            || !Number.isFinite(position.x)
            || !Number.isFinite(position.y)
        ) {
            return null;
        }

        const normalizedX = THREE.MathUtils.clamp(position.x / Math.max(window.innerWidth, 1), 0, 1);
        const normalizedY = THREE.MathUtils.clamp(position.y / Math.max(window.innerHeight, 1), 0, 1);
        const corridor = this.getStageCorridorBounds();

        return new THREE.Vector3(
            THREE.MathUtils.lerp(-corridor.width * 0.46, corridor.width * 0.46, normalizedX),
            THREE.MathUtils.lerp(corridor.top, corridor.bottom, normalizedY),
            -1,
        );
    }

    getStageOriginFromPiece(piece) {
        if (!piece?.shape || !Array.isArray(piece.shape)) {
            return new THREE.Vector3(0, -this.screenBounds.height * 0.18, -1.5);
        }

        let sumX = 0;
        let sumY = 0;
        let cells = 0;
        piece.shape.forEach((row, localY) => {
            row.forEach((value, localX) => {
                if (!value) return;
                sumX += (piece.x ?? 4) + localX + 0.5;
                sumY += (piece.y ?? 10) + localY + 0.5;
                cells += 1;
            });
        });

        const centerX = cells > 0 ? sumX / cells : (piece.x ?? 4.5);
        const centerY = cells > 0 ? sumY / cells : (piece.y ?? 10);
        const stagePoint = this.mapBoardPointToStage(centerX, centerY, -1.4);
        return new THREE.Vector3(stagePoint.x, stagePoint.y, stagePoint.z);
    }

    getLineBandData(data = {}) {
        const rows = Array.isArray(data.clearedRows) && data.clearedRows.length > 0
            ? data.clearedRows
            : null;
        const lineCount = data?.lineCount || 1;

        if (rows) {
            const avgRow = rows.reduce((sum, row) => sum + row, 0) / rows.length;
            const stagePoint = this.mapBoardPointToStage(4.5, avgRow + 0.5, -0.8);
            return {
                y: stagePoint.y,
                height: THREE.MathUtils.clamp(0.18 + rows.length * 0.045, 0.18, 0.38),
            };
        }

        const fallbackY = THREE.MathUtils.lerp(
            this.screenBounds.height * 0.08,
            -this.screenBounds.height * 0.16,
            THREE.MathUtils.clamp((lineCount - 1) / 3, 0, 1),
        );
        return {
            y: fallbackY,
            height: THREE.MathUtils.clamp(0.2 + lineCount * 0.04, 0.2, 0.36),
        };
    }

    updateImpactScreenFromWorld(worldPosition) {
        if (!this.camera || !worldPosition) return;

        this.tmpVec3B.copy(worldPosition).project(this.camera);
        this.fxState.impactScreen.set(
            THREE.MathUtils.clamp(this.tmpVec3B.x * 0.5 + 0.5, 0, 1),
            THREE.MathUtils.clamp(1 - (this.tmpVec3B.y * 0.5 + 0.5), 0, 1),
        );
    }

    setImpactOrigin(worldPosition, direction = null) {
        if (!worldPosition) return;

        this.fxState.impactOrigin.copy(worldPosition);
        this.fxState.hasImpactOrigin = true;
        if (direction) {
            this.fxState.impactDirection.copy(direction).normalize();
        } else {
            this.fxState.impactDirection.set(0, 0.3, 1).normalize();
        }
        this.updateImpactScreenFromWorld(worldPosition);
    }

    getColorFromValue(value, fallback = 0x00ffcc, target = null) {
        const out = target || new THREE.Color();
        if (value?.isColor) return out.copy(value);
        if (typeof value === 'string' || typeof value === 'number') return out.set(value);
        return out.set(fallback);
    }

    getEventColorFromPiece(piece) {
        const out = this._scratchColors[0];
        if (piece?.color) {
            return this.getColorFromValue(piece.color, 0x00ffcc, out);
        }

        const fallback = ELECTRIC_DREAMS_TETROMINOS.colors?.[piece?.type];
        if (fallback) {
            return out.set(fallback);
        }

        return out.copy(BLOB_COLORS[Math.floor((this.time * 3) % BLOB_COLORS.length)]);
    }

    applyBlobReaction(origin, options = {}) {
        if (!origin || !this.blobs.length) return;

        const {
            strength = 0.4,
            flowStrength = 0.3,
            accentColor = null,
            affectedCount = 2,
            echoStrength = 0.24,
            direction = null,
        } = options;

        // Compute distances in pre-allocated array (no .map/.sort allocation)
        const blobs = this.blobs;
        const count = blobs.length;
        const dists = this._blobDistances;
        for (let i = 0; i < count; i++) {
            dists[i] = blobs[i].mainMesh?.position?.distanceTo(origin) ?? Number.MAX_SAFE_INTEGER;
        }

        // Find the N nearest blobs via N linear scans (faster than sort for affectedCount <= 4)
        const nearestFlags = new Uint8Array(count); // 0 = not selected
        for (let n = 0; n < Math.min(affectedCount, count); n++) {
            let minDist = Number.MAX_SAFE_INTEGER;
            let minIdx = -1;
            for (let i = 0; i < count; i++) {
                if (!nearestFlags[i] && dists[i] < minDist) {
                    minDist = dists[i];
                    minIdx = i;
                }
            }
            if (minIdx >= 0) nearestFlags[minIdx] = 1;
        }

        const screenWidth = this.screenBounds.width * 0.95;
        for (let i = 0; i < count; i++) {
            const blob = blobs[i];
            const distance = dists[i];
            const tierWeight = blob.heroWeight ?? 1;
            const nearWeight = THREE.MathUtils.clamp(1 - (distance / screenWidth), 0.18, 1);
            const echoWeight = nearestFlags[i] ? 1 : echoStrength;
            const reaction = strength * nearWeight * echoWeight * tierWeight;
            if (reaction <= 0.01) continue;

            blob.reactionTarget = Math.max(blob.reactionTarget, reaction);
            blob.flowTarget = Math.max(blob.flowTarget, reaction * flowStrength * 1.6);
            blob.rimBoostTarget = Math.max(blob.rimBoostTarget, reaction * 0.95);
            blob.eventColorTarget = Math.max(blob.eventColorTarget, reaction * 0.82);
            if (accentColor) {
                blob.eventColor.copy(accentColor);
            }

            const baseDirection = this.tmpVec3C.copy(blob.homePosition).sub(origin);
            if (baseDirection.lengthSq() < 0.0001) {
                baseDirection.set((i % 2 === 0 ? -1 : 1) * 0.1, 0.15, 0.8);
            }
            baseDirection.normalize();
            if (direction) {
                baseDirection.lerp(direction, 0.45).normalize();
            }
            blob.reactionVectorTarget.copy(baseDirection);
        }
    }

    getComboOrigin() {
        if (this.fxState.hasImpactOrigin) {
            return this._scratchOriginVec.copy(this.fxState.impactOrigin);
        }
        const heroBlob = this.blobs.find((blob) => blob.tier === 'hero') || this.blobs[0];
        return heroBlob?.homePosition
            ? this._scratchOriginVec.copy(heroBlob.homePosition)
            : this._scratchOriginVec.set(0, 0, -1.5);
    }

    createDebugPiecePayload(type = 'T', x = 4, y = 15) {
        const shapes = {
            I: [[1, 1, 1, 1]],
            O: [[1, 1], [1, 1]],
            T: [[0, 1, 0], [1, 1, 1]],
            L: [[0, 0, 1], [1, 1, 1]],
        };

        return {
            type,
            x,
            y,
            color: ELECTRIC_DREAMS_TETROMINOS.colors?.[type] || '#62f6ff',
            shape: shapes[type] || shapes.T,
        };
    }

    playHeroSequence() {
        if (!this.isActive) return false;

        const steps = [
            { delay: 0, event: EVENTS.PIECE_LOCK, payload: { piece: this.createDebugPiecePayload('T', 4, 16) } },
            { delay: 240, event: EVENTS.LINE_CLEAR, payload: { lineCount: 1, clearedRows: [18] } },
            { delay: 540, event: EVENTS.PIECE_LOCK, payload: { piece: this.createDebugPiecePayload('L', 5, 14) } },
            { delay: 780, event: EVENTS.LINE_CLEAR, payload: { lineCount: 3, clearedRows: [15, 16, 17] } },
            { delay: 1120, event: EVENTS.COMBO, payload: { comboCount: 4 } },
            { delay: 1520, event: EVENTS.PIECE_LOCK, payload: { piece: this.createDebugPiecePayload('I', 4, 12) } },
            { delay: 1760, event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [16, 17, 18, 19] } },
            { delay: 2020, event: EVENTS.COMBO, payload: { comboCount: 8 } },
            { delay: 2460, event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [14, 15, 16, 17], backToBack: true } },
        ];

        steps.forEach((step) => {
            this.registerTimeout(() => {
                if (!this.isActive) return;
                eventBus.emit(step.event, step.payload);
            }, step.delay);
        });

        return true;
    }

    playParticleReview() {
        if (!this.isActive) return false;

        const steps = [
            { delay: 240, event: EVENTS.PIECE_LOCK, payload: { piece: this.createDebugPiecePayload('T', 4, 17) } },
            { delay: 720, event: EVENTS.LINE_CLEAR, payload: { lineCount: 3, clearedRows: [16, 17, 18] } },
            { delay: 1240, event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [15, 16, 17, 18] } },
            { delay: 1760, event: EVENTS.COMBO, payload: { comboCount: 4 } },
            { delay: 2280, event: EVENTS.COMBO, payload: { comboCount: 8 } },
            { delay: 2880, event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [14, 15, 16, 17], backToBack: true } },
        ];

        steps.forEach((step) => {
            this.registerTimeout(() => {
                if (!this.isActive) return;
                eventBus.emit(step.event, step.payload);
            }, step.delay);
        });

        return true;
    }

    playStageArcReview() {
        if (!this.isActive) return false;

        const actSteps = [
            { delay: 0, progress: 0.08 },
            { delay: 180, event: EVENTS.PIECE_LOCK, payload: { piece: this.createDebugPiecePayload('T', 4, 17) } },
            { delay: 520, event: EVENTS.LINE_CLEAR, payload: { lineCount: 1, clearedRows: [18] } },
            { delay: 980, progress: 0.42 },
            { delay: 1180, event: EVENTS.LINE_CLEAR, payload: { lineCount: 3, clearedRows: [15, 16, 17] } },
            { delay: 1640, event: EVENTS.COMBO, payload: { comboCount: 4 } },
            { delay: 2180, progress: 0.84 },
            { delay: 2360, event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [15, 16, 17, 18] } },
            { delay: 2760, event: EVENTS.COMBO, payload: { comboCount: 8 } },
            { delay: 3260, event: EVENTS.LINE_CLEAR, payload: { lineCount: 4, clearedRows: [14, 15, 16, 17], backToBack: true } },
        ];

        actSteps.forEach((step) => {
            this.registerTimeout(() => {
                if (!this.isActive) return;
                if (typeof step.progress === 'number') {
                    this.stageConductor?.debugSetActProgress?.(step.progress);
                    return;
                }
                eventBus.emit(step.event, step.payload);
            }, step.delay);
        });

        return true;
    }

    registerDebugHelpers() {
        if (typeof window === 'undefined' || this.debugHelpersRegistered) return;

        window.electricDreamsDebug = {
            playHeroSequence: () => this.playHeroSequence(),
            playStageReview: () => this.playStageArcReview(),
            playParticleReview: () => this.playParticleReview(),
            playStageArcReview: () => this.playStageArcReview(),
        };
        this.debugHelpersRegistered = true;
    }

    unregisterDebugHelpers() {
        if (typeof window === 'undefined') return;
        if (
            window.electricDreamsDebug?.playHeroSequence
            || window.electricDreamsDebug?.playStageReview
            || window.electricDreamsDebug?.playParticleReview
            || window.electricDreamsDebug?.playStageArcReview
        ) {
            delete window.electricDreamsDebug;
        }
        this.debugHelpersRegistered = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Background
    // ─────────────────────────────────────────────────────────────────────────
    createBackground() {
        // Low-poly sphere is enough — the shader is a smooth gradient with
        // no displacement, so tessellation buys nothing. Going from (32,24)
        // to (12,8) drops 1536→192 triangles, ~8× geometry reduction.
        const bgGeo = new THREE.SphereGeometry(200, 12, 8);

        // Always start with the lightweight WebGL shader for fast first frame.
        // The TSL FBM material is upgraded in via upgradeBackground() in deferred tier 1.
        const bgMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vWorldPos;
                void main() {
                    float y = normalize(vWorldPos).y;
                    vec3 deepPurple = vec3(0.04, 0.01, 0.07);
                    vec3 darkBlue = vec3(0.01, 0.02, 0.06);
                    vec3 pureBlack = vec3(0.012, 0.007, 0.025);
                    vec3 color = mix(pureBlack, deepPurple, smoothstep(-1.0, 0.0, y) * 0.5);
                    color = mix(color, darkBlue, smoothstep(0.0, 1.0, y) * 0.4);
                    float nebula = sin(y * 5.0 + uTime * 0.08) * cos(normalize(vWorldPos).x * 3.0 + uTime * 0.1);
                    nebula = pow(max(0.0, nebula), 6.0) * 0.06;
                    color += vec3(0.08, 0.01, 0.12) * nebula;
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            fog: false,
        });
        this.backgroundMesh = new THREE.Mesh(bgGeo, bgMat);
        this.backgroundUniforms = null;
        this.backgroundNeedsUpgrade = this.isWebGPU && !!this.webgpuMaterials;

        this.scene.add(this.backgroundMesh);
    }

    upgradeBackground() {
        if (!this.backgroundNeedsUpgrade || !this.webgpuMaterials || !this.backgroundMesh) return;
        this.backgroundNeedsUpgrade = false;

        const oldMat = this.backgroundMesh.material;
        const { material, uniforms } = this.webgpuMaterials.createBackgroundNodeMaterial();
        this.applyMrtPatchToMaterial(material);
        this.backgroundMesh.material = material;
        this.backgroundUniforms = uniforms;
        if (uniforms.uTime) {
            uniforms.uTime.value = this.time;
        }
        oldMat.dispose();
    }

    getBoardHaloRect() {
        return {
            halfWidth: this.screenBounds.width * 0.108,
            halfHeight: this.screenBounds.height * 0.338,
            z: 5.6,
        };
    }

    createBoardHalo() {
        if (!this.scene || this.boardHaloMesh) return;

        const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
        const rect = this.getBoardHaloRect();

        if (this.isWebGPU && this.webgpuMaterials?.createBoardHaloNodeMaterial) {
            const { material, uniforms } = this.webgpuMaterials.createBoardHaloNodeMaterial();
            this.applyMrtPatchToMaterial(material);
            this.boardHaloMesh = new THREE.Mesh(geometry, material);
            this.boardHaloUniforms = uniforms;
        } else {
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uEnergy: { value: 0.2 },
                    uRingPulse: { value: 0 },
                    uSecondaryRing: { value: 0 },
                    uRowPulse: { value: 0 },
                    uTakeover: { value: 0 },
                    uBeatPulse: { value: 0 },
                    uLineFocusY: { value: 0 },
                    uLineFocusHeight: { value: 0.18 },
                    uAccentA: { value: new THREE.Color(0x62f6ff) },
                    uAccentB: { value: new THREE.Color(0xff00ff) },
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
                    uniform float uEnergy;
                    uniform float uRingPulse;
                    uniform float uSecondaryRing;
                    uniform float uRowPulse;
                    uniform float uTakeover;
                    uniform float uBeatPulse;
                    uniform float uLineFocusY;
                    uniform float uLineFocusHeight;
                    uniform vec3 uAccentA;
                    uniform vec3 uAccentB;
                    varying vec2 vUv;

                    void main() {
                        vec2 centered = vUv - 0.5;
                        vec2 absCentered = abs(centered);
                        float edgeDist = max(absCentered.x * 1.16, absCentered.y * 1.56);
                        float innerMask = smoothstep(0.34, 0.49, edgeDist);
                        float outerMask = 1.0 - smoothstep(0.49, 0.64, edgeDist);
                        float frameMask = innerMask * outerMask;
                        float perimeterWave = sin(uTime * 1.3 + centered.x * 16.0 + centered.y * 11.0) * 0.08 + 0.96;
                        float ringBand = smoothstep(0.18, 0.0, abs(edgeDist - 0.54));
                        float secondaryBand = smoothstep(0.1, 0.0, abs(edgeDist - 0.44));
                        float rowMask = smoothstep(
                            uLineFocusHeight + 0.06,
                            uLineFocusHeight * 0.24,
                            abs(centered.y - uLineFocusY)
                        );
                        float takeoverGlow = smoothstep(0.58, 0.1, length(centered)) * uTakeover * 0.38;
                        float accentMix = clamp(centered.x * 0.6 + 0.5 + uBeatPulse * 0.08, 0.0, 1.0);
                        vec3 accentColor = mix(uAccentA, uAccentB, accentMix);
                        float energyCore = frameMask
                            * (0.12 + uEnergy * 0.34 + uBeatPulse * 0.12)
                            * perimeterWave;
                        float ringGlow = ringBand * (uRingPulse * 0.7 + uBeatPulse * 0.16);
                        float secondaryGlow = secondaryBand * uSecondaryRing * 0.42;
                        float rowGlow = rowMask * uRowPulse * 0.26;
                        vec3 color = accentColor * (energyCore + ringGlow + secondaryGlow)
                            + uAccentA * (rowGlow * 0.75)
                            + uAccentB * (takeoverGlow * 0.6);
                        float alpha = clamp(
                            energyCore * 0.34
                                + ringGlow * 0.24
                                + secondaryGlow * 0.18
                                + rowGlow * 0.22
                                + takeoverGlow * 0.16,
                            0.0,
                            0.82
                        );
                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });
            this.boardHaloMesh = new THREE.Mesh(geometry, material);
            this.boardHaloUniforms = material.uniforms;
        }

        this.boardHaloMesh.frustumCulled = false;
        this.boardHaloMesh.renderOrder = 3;
        this.boardHaloMesh.position.set(0, 0, rect.z);
        this.boardHaloMesh.scale.set(rect.halfWidth * 2, rect.halfHeight * 2, 1);
        this.scene.add(this.boardHaloMesh);
    }

    updateBoardHaloLayout() {
        if (!this.boardHaloMesh) return;
        const rect = this.getBoardHaloRect();
        this.boardHaloMesh.position.set(0, 0, rect.z);
        this.boardHaloMesh.scale.set(rect.halfWidth * 2, rect.halfHeight * 2, 1);
    }

    createBoardHaloEmbers() {
        if (!this.scene || this.boardHaloEmbers || (this.qualityPreset.boardHaloEmberCount ?? 0) <= 0) return;

        const count = this.qualityPreset.boardHaloEmberCount;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const progress = new Float32Array(count);
        const laterals = new Float32Array(count);
        const depths = new Float32Array(count);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i += 1) {
            const baseColor = BLOB_COLORS[i % BLOB_COLORS.length];
            colors[(i * 3)] = baseColor.r;
            colors[(i * 3) + 1] = baseColor.g;
            colors[(i * 3) + 2] = baseColor.b;
            sizes[i] = THREE.MathUtils.lerp(2.2, 6.6, Math.random());
            phases[i] = Math.random() * Math.PI * 2;
            progress[i] = Math.random();
            laterals[i] = (Math.random() - 0.5) * 0.2;
            depths[i] = Math.random();
            speeds[i] = 0.034 + Math.random() * 0.094;
        }

        const positionAttr = new THREE.BufferAttribute(positions, 3);
        positionAttr.setUsage(THREE.DynamicDrawUsage);
        const colorAttr = new THREE.BufferAttribute(colors, 3);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('color', colorAttr);
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setDrawRange(0, count);

        let material;
        let uniforms;

        if (this.isWebGPU && this.webgpuMaterials?.createBoardHaloEmbersNodeMaterial) {
            const result = this.webgpuMaterials.createBoardHaloEmbersNodeMaterial();
            material = result.material;
            uniforms = result.uniforms;
            this.applyMrtPatchToMaterial(material);
        } else {
            material = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uEnergy: { value: 0 },
                },
                vertexShader: `
                    attribute vec3 color;
                    attribute float size;
                    varying vec3 vColor;
                    varying float vEnergy;
                    uniform float uTime;
                    uniform float uEnergy;
                    void main() {
                        vColor = color;
                        vEnergy = uEnergy;
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = size * (186.0 / -mvPosition.z) * (0.9 + uEnergy * 0.58);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    varying vec3 vColor;
                    varying float vEnergy;
                    void main() {
                        vec2 coord = gl_PointCoord - 0.5;
                        float dist = length(coord);
                        if (dist > 0.5) discard;
                        float glow = pow(1.0 - smoothstep(0.0, 0.5, dist), 4.0);
                        float ring = smoothstep(0.46, 0.18, dist) * smoothstep(0.06, 0.24, dist);
                        vec3 color = vColor * (glow * (1.14 + vEnergy * 0.42) + ring * 0.32);
                        gl_FragColor = vec4(color, glow * (0.76 + vEnergy * 0.16));
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });
            uniforms = material.uniforms;
        }

        this.boardHaloEmbers = new THREE.Points(geometry, material);
        this.boardHaloEmbers.frustumCulled = false;
        this.boardHaloEmbers.renderOrder = 4;
        this.scene.add(this.boardHaloEmbers);
        this.boardHaloState = {
            count,
            positions,
            colors,
            sizes,
            phases,
            progress,
            laterals,
            depths,
            speeds,
            positionAttr,
            colorAttr,
            uniforms,
        };
    }

    destroyBoardHalo() {
        if (this.boardHaloMesh) {
            this.boardHaloMesh.geometry?.dispose?.();
            this.boardHaloMesh.material?.dispose?.();
            this.scene?.remove?.(this.boardHaloMesh);
            this.boardHaloMesh = null;
        }
        this.boardHaloUniforms = null;

        if (this.boardHaloEmbers) {
            this.boardHaloEmbers.geometry?.dispose?.();
            this.boardHaloEmbers.material?.dispose?.();
            this.scene?.remove?.(this.boardHaloEmbers);
            this.boardHaloEmbers = null;
        }
        this.boardHaloState = null;
    }

    sampleBoardHaloPerimeterPoint(progress, lateral, depth, out = this.tmpVec3A) {
        const rect = this.getBoardHaloRect();
        const angle = progress * Math.PI * 2;
        const radiusX = rect.halfWidth * (1.0 + Math.sin(angle * 2.0) * 0.05 + lateral * 0.08);
        const radiusY = rect.halfHeight * (1.0 + Math.cos(angle * 3.0) * 0.04 + lateral * 0.05);
        const x = Math.cos(angle) * radiusX;
        const y = Math.sin(angle) * radiusY;
        const z = rect.z - 0.8 - depth * 5.4 + Math.sin(angle * 4.0 + lateral * 7.0) * 0.2;
        return out.set(x, y, z);
    }

    updateBoardHalo(delta) {
        if (!this.boardHaloMesh || !this.boardHaloController) return;

        const haloState = this.boardHaloController.update(delta, this.conductorChannels, this.fxState);
        this.fxState.boardHaloEnergy = haloState.energy;

        if (this.boardHaloUniforms) {
            this.boardHaloUniforms.uTime.value = this.time;
            this.boardHaloUniforms.uEnergy.value = haloState.energy;
            this.boardHaloUniforms.uRingPulse.value = haloState.ringPulse;
            this.boardHaloUniforms.uSecondaryRing.value = this.particleOrchestrator?.shouldShowSecondaryHalo?.(
                this.adaptiveBudgetState?.effectsShedLevel ?? 0,
            ) ? haloState.secondaryRing : 0;
            this.boardHaloUniforms.uRowPulse.value = haloState.rowPulse;
            this.boardHaloUniforms.uTakeover.value = haloState.takeover;
            if (this.boardHaloUniforms.uBeatPulse) {
                this.boardHaloUniforms.uBeatPulse.value = this.conductorChannels.beatPulse ?? 0;
            }
            this.boardHaloUniforms.uLineFocusY.value = haloState.lineFocusY / Math.max(this.screenBounds.height, 1);
            this.boardHaloUniforms.uLineFocusHeight.value = haloState.lineFocusHeight / Math.max(this.screenBounds.height, 1);
            this.boardHaloUniforms.uAccentA.value.copy(haloState.accent);
            this.boardHaloUniforms.uAccentB.value.copy(haloState.support);
        }

        const emberState = this.boardHaloState;
        if (!emberState || !this.boardHaloEmbers) return;

        const visibleCount = this.particleOrchestrator?.getBoardHaloVisibleCount?.(
            emberState.count,
            this.conductorChannels,
            this.adaptiveBudgetState?.effectsShedLevel ?? 0,
        ) ?? emberState.count;
        const accentA = haloState.accent;
        const accentB = haloState.support;
        const { energy } = haloState;
        const beatPulse = this.conductorChannels.beatPulse ?? 0;

        for (let i = 0; i < visibleCount; i += 1) {
            emberState.progress[i] += delta * emberState.speeds[i] * (0.8 + energy * 0.45 + beatPulse * 0.2);
            if (emberState.progress[i] > 1) emberState.progress[i] -= 1;
            this.sampleBoardHaloPerimeterPoint(
                emberState.progress[i] + emberState.phases[i] * 0.015,
                emberState.laterals[i],
                emberState.depths[i],
                this.tmpVec3A,
            );
            const idx = i * 3;
            emberState.positions[idx] = this.tmpVec3A.x;
            emberState.positions[idx + 1] = this.tmpVec3A.y;
            emberState.positions[idx + 2] = this.tmpVec3A.z;

            const mix = (Math.sin(emberState.phases[i] + this.time * 0.65) * 0.5 + 0.5) * (0.56 + energy * 0.2);
            emberState.colors[idx] = THREE.MathUtils.lerp(accentA.r, accentB.r, mix);
            emberState.colors[idx + 1] = THREE.MathUtils.lerp(accentA.g, accentB.g, mix);
            emberState.colors[idx + 2] = THREE.MathUtils.lerp(accentA.b, accentB.b, mix);
        }

        emberState.uniforms.uTime.value = this.time;
        emberState.uniforms.uEnergy.value = energy;
        emberState.positionAttr.needsUpdate = true;
        emberState.colorAttr.needsUpdate = true;
        this.boardHaloEmbers.geometry.setDrawRange(0, visibleCount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blobs (multi-layer in WebGPU, single mesh in WebGL)
    // ─────────────────────────────────────────────────────────────────────────
    createInitialBlobs() {
        this.blobTierCounts = { hero: 0, support: 0, ghost: 0 };
        this.pendingBlobQueue = [];
        this.blobLoadingComplete = false;

        const count = this.qualityPreset.blobCount;
        const heroCount = this.qualityPreset.tierCounts?.hero || 1;
        // Only create hero blob(s) synchronously — that's enough for a meaningful
        // first frame. Everything else streams in via loadNextBlobBatch (4/frame).
        // Reduces sync init from up to 4 blobs (~30-50ms incl shader compile) to 1-2.
        const immediateCount = Math.min(count, heroCount);

        for (let i = 0; i < immediateCount; i++) {
            this.createBlob(i);
        }

        // Queue remaining blobs for progressive loading across frames
        for (let i = immediateCount; i < count; i++) {
            this.pendingBlobQueue.push(i);
        }

        if (this.pendingBlobQueue.length === 0) {
            this.blobLoadingComplete = true;
        }
    }

    loadNextBlobBatch(batchSize = 2) {
        if (this.blobLoadingComplete || !this.pendingBlobQueue.length) return;

        const toCreate = Math.min(batchSize, this.pendingBlobQueue.length);
        for (let i = 0; i < toCreate; i++) {
            const blobIndex = this.pendingBlobQueue.shift();
            this.createBlob(blobIndex);
        }

        if (this.pendingBlobQueue.length === 0) {
            this.blobLoadingComplete = true;
        }
    }

    createBlob(index) {
        const tier = this.getBlobTier(index);
        const tierIndex = this.blobTierCounts[tier] || 0;
        this.blobTierCounts[tier] = tierIndex + 1;
        const anchor = this.buildBlobAnchor(index, tier, tierIndex);
        const { scale } = anchor;
        const detail = this.qualityPreset.blobDetail || 5;
        const resolvedDetail = tier === 'hero'
            ? detail + 1
            : (tier === 'ghost' ? Math.max(2, detail - 1) : detail);
        const color = BLOB_COLORS[index % BLOB_COLORS.length].clone();
        const position = anchor.position.clone();

        let corridorBias = 0.35;
        if (tier === 'hero') {
            corridorBias = 1;
        } else if (tier === 'support') {
            corridorBias = 0.65;
        }
        let depthBiasRange = 0.4;
        if (tier === 'hero') {
            depthBiasRange = 0.9;
        } else if (tier === 'support') {
            depthBiasRange = 0.6;
        }

        const blobData = {
            scale,
            detail: resolvedDetail,
            tier,
            tierIndex,
            motionProfile: BLOB_MOTION_PROFILES[tier] || BLOB_MOTION_PROFILES.support,
            driftScale: anchor.driftScale,
            heroWeight: anchor.heroWeight,
            stageWeight: anchor.stageWeight,
            meshes: [], // All meshes for this blob
            mainMesh: null,
            interiorMesh: null,
            glowMesh: null,
            mainUniforms: null,
            interiorUniforms: null,
            glowUniforms: null,
            baseColor: color,
            currentColor: color.clone(),
            // Motion params
            phaseX: Math.random() * Math.PI * 2,
            phaseY: Math.random() * Math.PI * 2,
            phaseZ: Math.random() * Math.PI * 2,
            restPhase: Math.random() * Math.PI * 2,
            freqX: 0.20 + Math.random() * 0.25,
            freqY: 0.16 + Math.random() * 0.22,
            freqZ: 0.14 + Math.random() * 0.20,
            ampX: 0.7 + Math.random() * 0.9,
            ampY: 0.6 + Math.random() * 0.75,
            ampZ: 0.4 + Math.random() * 0.55,
            freq2X: 0.05 + Math.random() * 0.08,
            freq2Y: 0.04 + Math.random() * 0.06,
            rotSpeedX: (Math.random() - 0.5) * 0.002,
            rotSpeedY: (Math.random() - 0.5) * 0.003,
            rotSpeedZ: (Math.random() - 0.5) * 0.001,
            morphBase: 0.3 + Math.random() * 0.4,
            morphPhase: Math.random() * Math.PI * 2,
            scalePhase: Math.random() * Math.PI * 2,
            baseScale: scale,
            calmScale: scale,
            hotScale: anchor.hotScale,
            targetScale: scale,
            scaleVelocity: 0,
            proximityBoost: 0,
            nearestDir: new THREE.Vector3(),
            homePosition: position.clone(),
            hotPosition: anchor.hotPosition.clone(),
            dynamicAnchor: position.clone(),
            anchorOffset: new THREE.Vector3(),
            anchorVelocity: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            depthBias: (Math.random() - 0.5) * depthBiasRange,
            depthOffset: 0,
            depthVelocity: 0,
            motionActivity: tier === 'hero' ? 0.92 : (tier === 'support' ? 0.82 : 0.7),
            motionBias: 0.88 + Math.random() * 0.18,
            convectionPhase: Math.random() * Math.PI * 2,
            convectionSpeed: 0.18 + Math.random() * 0.14,
            convectionValue: 0,
            clusterWeight: 0,
            mergeAffinity: 0,
            contactBlend: 0,
            clusterScaleBlend: 0,
            clusterCenter: new THREE.Vector3(),
            clusterVector: new THREE.Vector3(),
            clusterFlowDirection: new THREE.Vector3(0, 0.15, 1).normalize(),
            mergeColor: color.clone(),
            mergeColorStrength: 0,
            eventColor: color.clone(),
            eventColorTarget: 0,
            eventColorStrength: 0,
            reaction: 0,
            reactionTarget: 0,
            rimBoost: 0,
            rimBoostTarget: 0,
            flowStrength: 0,
            flowTarget: 0,
            reactionVector: new THREE.Vector3(0, 0.15, 1).normalize(),
            reactionVectorTarget: new THREE.Vector3(0, 0.15, 1).normalize(),
            rotationVelocity: new THREE.Vector3(),
            corridorBias,
        };

        if (this.isWebGPU && this.webgpuMaterials) {
            this.createWebGPUBlob(blobData, scale, resolvedDetail, color, position);
        } else {
            this.createWebGLBlob(blobData, scale, resolvedDetail, color, position);
        }

        this.blobs.push(blobData);
    }

    createWebGPUBlob(blobData, scale, detail, color, position) {
        // Main blob surface (1.0x)
        const mainGeo = this.getSharedBlobGeometry(detail);
        const { material: mainMat, uniforms: mainU } = this.webgpuMaterials.createBlobNodeMaterial({ color });
        this.applyMrtPatchToMaterial(mainMat);
        const mainMesh = new THREE.Mesh(mainGeo, mainMat);
        mainMesh.position.copy(position);
        mainMesh.scale.setScalar(scale * BLOB_LAYER_SCALES.main);
        mainMesh.userData.baseScaleMultiplier = BLOB_LAYER_SCALES.main;
        this.scene.add(mainMesh);
        blobData.mainMesh = mainMesh;
        blobData.mainUniforms = mainU;
        blobData.meshes.push(mainMesh);
    }

    attachBlobInteriorLayer(blobData) {
        if (!this.webgpuMaterials || blobData.interiorMesh) return;

        const detail = blobData.detail || this.qualityPreset.blobDetail || 2;
        const interiorGeo = this.getSharedBlobGeometry(Math.max(detail - 1, 1));
        const { material, uniforms } = this.webgpuMaterials.createBlobInteriorNodeMaterial({
            color: blobData.baseColor,
        });
        this.applyMrtPatchToMaterial(material);

        const mesh = new THREE.Mesh(interiorGeo, material);
        mesh.position.copy(blobData.mainMesh.position);
        mesh.scale.setScalar(blobData.baseScale * BLOB_LAYER_SCALES.interior);
        mesh.userData.baseScaleMultiplier = BLOB_LAYER_SCALES.interior;
        this.scene.add(mesh);

        blobData.interiorMesh = mesh;
        blobData.interiorUniforms = uniforms;
        blobData.meshes.push(mesh);
    }

    attachBlobGlowLayer(blobData) {
        if (!this.webgpuMaterials || blobData.glowMesh) return;

        const detail = blobData.detail || this.qualityPreset.blobDetail || 2;
        const glowGeo = this.getSharedBlobGeometry(Math.max(detail - 1, 1));
        const { material: glowMat, uniforms: glowU } = this.webgpuMaterials.createBlobGlowNodeMaterial({
            color: blobData.baseColor,
        });
        this.applyMrtPatchToMaterial(glowMat);

        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.copy(blobData.mainMesh.position);
        glowMesh.scale.setScalar(blobData.baseScale * BLOB_LAYER_SCALES.glow);
        glowMesh.userData.baseScaleMultiplier = BLOB_LAYER_SCALES.glow;
        this.scene.add(glowMesh);

        blobData.glowMesh = glowMesh;
        blobData.glowUniforms = glowU;
        blobData.meshes.push(glowMesh);
    }

    attachDeferredBlobLayers() {
        if (!this.isWebGPU || !this.webgpuMaterials) return;

        this.blobs.forEach((blobData) => {
            if (this.qualityPreset.useInterior) {
                this.attachBlobInteriorLayer(blobData);
            }
            if (this.qualityPreset.useGlow) {
                this.attachBlobGlowLayer(blobData);
            }
        });
    }

    createWebGLBlob(blobData, scale, detail, color, position) {
        const geo = this.getSharedBlobGeometry(detail);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: color.clone() },
                uPulseIntensity: { value: 0 },
                uMorphFactor: { value: 0 },
            },
            vertexShader: BlobShader.vertexShader,
            fragmentShader: BlobShader.fragmentShader,
            transparent: true,
            side: THREE.FrontSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        mesh.scale.setScalar(scale);
        mesh.userData.baseScaleMultiplier = BLOB_LAYER_SCALES.main;
        this.scene.add(mesh);
        blobData.mainMesh = mesh;
        blobData.mainUniforms = null; // WebGL uses material.uniforms directly
        blobData.meshes.push(mesh);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Spark Particles (GPU compute in WebGPU, CPU in WebGL)
    // ─────────────────────────────────────────────────────────────────────────
    async createSparkSystem() {
        if (this.isWebGPU && this.webgpuMaterials) {
            if (this.flags.useCompute) {
                try {
                    await this.createWebGPUSparks({ useCompute: true });
                    return;
                } catch (error) {
                    console.warn('[ElectricDreams] GPU compute sparks failed, rebuilding without compute:', error);
                    this.flags.useCompute = false;
                }
            }

            await this.createWebGPUSparks({ useCompute: false });
            return;
        }

        this.createWebGLSparks();
    }

    disposeSparkSystem() {
        if (this.sparkCompute) {
            this.sparkCompute.dispose();
            this.sparkCompute = null;
        }

        if (this.sparks) {
            this.sparks.geometry.dispose();
            this.sparks.material.dispose();
            this.scene?.remove(this.sparks);
            this.sparks = null;
        }

        this.sparkUniforms = null;
        this.ambientSparkState = null;
    }

    async rebuildSparksWithoutCompute(error) {
        if (this.computeFallbackPending) return;

        this.computeFallbackPending = true;
        this.flags.useCompute = false;
        console.warn('[ElectricDreams] Runtime compute failed, rebuilding sparks without compute:', error);

        this.disposeSparkSystem();

        try {
            if (this.isWebGPU && this.webgpuMaterials) {
                await this.createWebGPUSparks({ useCompute: false });
            } else {
                this.createWebGLSparks();
            }
        } catch (fallbackError) {
            console.warn('[ElectricDreams] Spark fallback failed, disabling sparks:', fallbackError);
            this.disposeSparkSystem();
        } finally {
            this.computeFallbackPending = false;
        }
    }

    async createWebGPUSparks(options = {}) {
        const useCompute = options.useCompute !== false;
        const count = this.qualityPreset.particleCount;
        const bounds = this.screenBounds;
        let sparkCompute = null;
        try {
            if (useCompute) {
                const { ElectricDreamsSparkCompute } = ElectricDreamsComputeModule;
                sparkCompute = new ElectricDreamsSparkCompute(count, {
                    boundsWidth: bounds.width,
                    boundsHeight: bounds.height,
                });
                sparkCompute.createComputeNode();
            }

            const { material, uniforms } = this.webgpuMaterials.createSparkNodeMaterial({
                pixelRatio: this.getCurrentSparkPixelRatio(),
                sparkCompute,
            });
            this.applyMrtPatchToMaterial(material);

            const geo = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            const colors = new Float32Array(count * 3);
            const sizes = new Float32Array(count);
            const seeds = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                if (!useCompute) {
                    positions[i * 3] = (Math.random() - 0.5) * bounds.width * 2;
                    positions[i * 3 + 1] = (Math.random() - 0.5) * bounds.height * 2;
                    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
                    sizes[i] = 2.0 + Math.random() * 5.0;
                    seeds[i] = Math.random();
                }
                const c = BLOB_COLORS[Math.floor(Math.random() * BLOB_COLORS.length)];
                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;
            }

            const positionAttr = new THREE.BufferAttribute(positions, 3);
            positionAttr.setUsage(THREE.DynamicDrawUsage);
            const colorAttr = new THREE.BufferAttribute(colors, 3);
            colorAttr.setUsage(THREE.DynamicDrawUsage);
            geo.setAttribute('position', positionAttr);
            geo.setAttribute('color', colorAttr);
            if (!useCompute) {
                const sizeAttr = new THREE.BufferAttribute(sizes, 1);
                sizeAttr.setUsage(THREE.DynamicDrawUsage);
                geo.setAttribute('aSize', sizeAttr);
                geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
            }

            this.sparks = new THREE.Points(geo, material);
            this.sparks.count = count;
            this.sparkCompute = sparkCompute;
            this.sparkUniforms = uniforms;
            this.scene.add(this.sparks);
            if (!useCompute) {
                this.initializeAmbientSparkState(geo, count);
                this.applyAmbientDrawRange();
            }
        } catch (error) {
            sparkCompute?.dispose?.();
            throw error;
        }
    }

    createWebGLSparks() {
        const count = this.qualityPreset.particleCount;
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        const bounds = this.screenBounds;

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * bounds.width * 2;
            positions[i * 3 + 1] = (Math.random() - 0.5) * bounds.height * 2;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
            sizes[i] = 3 + Math.random() * 6;
            phases[i] = Math.random();
            const c = BLOB_COLORS[Math.floor(Math.random() * BLOB_COLORS.length)];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }

        const positionAttr = new THREE.BufferAttribute(positions, 3);
        positionAttr.setUsage(THREE.DynamicDrawUsage);
        const sizeAttr = new THREE.BufferAttribute(sizes, 1);
        sizeAttr.setUsage(THREE.DynamicDrawUsage);
        const colorAttr = new THREE.BufferAttribute(colors, 3);
        colorAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', positionAttr);
        geo.setAttribute('size', sizeAttr);
        geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        geo.setAttribute('color', colorAttr);

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uComboIntensity: { value: 0 },
                uComboSpeedBoost: { value: 1 },
                uComboSizeBoost: { value: 1 },
            },
            vertexShader: SparkShader.vertexShader,
            fragmentShader: SparkShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.sparks = new THREE.Points(geo, mat);
        this.sparks.count = count;
        this.sparkUniforms = null;
        this.scene.add(this.sparks);
        this.initializeAmbientSparkState(geo, count);
        this.applyAmbientDrawRange();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Glass Overlay (WebGPU only)
    // ─────────────────────────────────────────────────────────────────────────
    createGlassOverlay() {
        if (!this.webgpuMaterials) return;
        // Low-poly: glass shader is a smooth scattering effect, no need for high tess.
        // (24,16)→(10,6) drops 384→60 triangles, ~6× reduction. Will be replaced by
        // a screen-space pass in fix #9 — this is the interim improvement.
        const glassGeo = new THREE.SphereGeometry(180, 10, 6);
        const { material, uniforms } = this.webgpuMaterials.createGlassOverlayNodeMaterial();
        this.applyMrtPatchToMaterial(material);
        this.glassMesh = new THREE.Mesh(glassGeo, material);
        this.glassUniforms = uniforms;
        this.scene.add(this.glassMesh);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Lighting
    // ─────────────────────────────────────────────────────────────────────────
    setupLighting() {
        const ambient = new THREE.AmbientLight(0x201030, 0.4);
        this.scene.add(ambient);

        const coreLight = new THREE.PointLight(0x00ffcc, 0.8, 80);
        coreLight.position.set(0, 0, 10);
        this.scene.add(coreLight);
        this.coreLight = coreLight;

        const rim1 = new THREE.PointLight(0xff00ff, 0.3, 60);
        rim1.position.set(-25, 10, 20);
        this.scene.add(rim1);

        const rim2 = new THREE.PointLight(0x0088ff, 0.3, 60);
        rim2.position.set(25, -10, 20);
        this.scene.add(rim2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Post-Processing
    // ─────────────────────────────────────────────────────────────────────────
    async setupPostProcessing() {
        this.disposePostProcessingStack();
        if (!this.flags.usePost) return;

        if (this.isWebGPU) {
            const postReadiness = this.auditScenePostReadiness();
            if (!postReadiness.ready) {
                console.warn('[ElectricDreams] Deferring WebGPU post until scene materials are node-ready:', postReadiness.offenders);
                this.deferPostSetupRetry('scene-materials-not-ready');
                return;
            }

            if (!this.auditSceneMrtReadiness()) {
                this.disableMrtRuntime('scene-mrt-audit-failed');
            }

            try {
                const postModule = this.modulePreloads.post
                    ? await this.modulePreloads.post
                    : ElectricDreamsPostModule;
                const { ElectricDreamsPost, getElectricDreamsPostProfile } = postModule;
                const profile = getElectricDreamsPostProfile(this.activeQualityLevel);
                this.postProfile = profile;
                this.postPipeline = new ElectricDreamsPost(
                    this.renderer,
                    this.scene,
                    this.camera,
                    {
                        ...profile,
                        useMRT: this.flags.useMRT,
                        resolutionScale: this.adaptiveBudgetState?.resolutionScale ?? 1,
                        pixelRatio: this.renderer?.getPixelRatio?.() || 1,
                    },
                );
                if (this.flags.useMRT && this.postPipeline.useMRT !== true) {
                    this.disableMrtRuntime('post-pipeline-rejected-mrt', this.postPipeline.mrtInitError);
                }
                this.baseBloomStrength = profile.bloomStrength;
                this.postPipeline.setPixelRatio?.(this.renderer?.getPixelRatio?.() || 1);
                this.postPipeline.setSize(window.innerWidth, window.innerHeight);
                this.applyAdaptivePostParams(true);
                return;
            } catch (error) {
                if (this.flags.useMRT) {
                    console.warn('[ElectricDreams] WebGPU post init failed with MRT, retrying without MRT:', error);
                    this.disableMrtRuntime('post-init-failed', error);
                    await this.setupPostProcessing();
                    return;
                }

                console.warn('[ElectricDreams] WebGPU post-processing failed, disabling post path:', error);
                this.flags.usePost = false;
                return;
            }
        }

        // WebGL fallback
        this.postProfile = null;
        this.composer = new EffectComposer(this.renderer);
        this.composer.setPixelRatio?.(this.renderer?.getPixelRatio?.() || 1);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            0.5,
            0.15,
        );
        this.composer.addPass(bloomPass);
        this.bloomPass = bloomPass;
        this.baseBloomStrength = this.qualityPreset.bloomStrength;
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    createAccentPalette(baseColor, extraColor = null) {
        this.getColorFromValue(baseColor, 0x00ffcc, this._scratchPalette[0]);
        if (extraColor) {
            this.getColorFromValue(extraColor, 0xff00ff, this._scratchPalette[1]);
        } else {
            this._scratchPalette[1].copy(this._scratchPalette[0]).offsetHSL(0.08, 0.05, 0.02);
        }
        this._scratchPalette[2].copy(this._scratchPalette[0]).offsetHSL(-0.06, 0.08, 0.03);
        return this._scratchPalette;
    }

    addStageHeat(amount) {
        this.fxState.stageHeat = THREE.MathUtils.clamp((this.fxState.stageHeat || 0) + amount, 0, 1);
    }

    updateStageState() {
        const heat = this.fxState.stageHeat || 0;
        if (heat >= 0.8) {
            this.fxState.stageState = 'overdrive';
        } else if (heat >= 0.55) {
            this.fxState.stageState = 'charged';
        } else if (heat >= 0.25) {
            this.fxState.stageState = 'active';
        } else {
            this.fxState.stageState = 'calm';
        }
    }

    getDangerFromOriginY(y) {
        const corridor = this.getStageCorridorBounds();
        const normalizedTop = THREE.MathUtils.inverseLerp(corridor.bottom, corridor.top, y ?? 0);
        return THREE.MathUtils.clamp(THREE.MathUtils.smootherstep(normalizedTop, 0.68, 0.96), 0, 1);
    }

    addDanger(amount, originY = null) {
        const positionalBias = originY == null ? 1 : (0.45 + this.getDangerFromOriginY(originY) * 0.9);
        this.fxState.dangerLevel = THREE.MathUtils.clamp(
            Math.max(this.fxState.dangerLevel, 0) + amount * positionalBias,
            0,
            1,
        );
    }

    relieveDanger(amount) {
        this.fxState.dangerLevel = THREE.MathUtils.clamp((this.fxState.dangerLevel || 0) - amount, 0, 1);
    }

    getEventDensityScale() {
        switch (this.activeQualityLevel) {
        case 'Extreme':
            return 1 + (this.fxState.actProgress * 0.08);
        case 'Ultra':
            return 0.94 + (this.fxState.actProgress * 0.06);
        case 'High':
            return 0.78 + (this.fxState.actProgress * 0.04);
        case 'Medium':
            return 0.62;
        case 'Low':
            return 0.48;
        default:
            return 0.36;
        }
    }

    getScaledParticleCount(minCount, maxCount, intensity = 1, multiplier = 1) {
        const density = this.getEventDensityScale() * this.getComboStreamerMultiplier() * multiplier;
        const count = THREE.MathUtils.lerp(minCount, maxCount, THREE.MathUtils.clamp(intensity, 0, 1));
        return Math.max(4, Math.round(count * density));
    }

    getHeroParticleCounts(baseRibbons, baseBeads, multiplier = 1) {
        const density = this.getHeroParticleDensityScale() * Math.max(multiplier, 0);
        return {
            ribbons: Math.max(0, Math.round(baseRibbons * density * this.getComboStreamerMultiplier())),
            beads: Math.max(0, Math.round(baseBeads * density * this.getDropletMultiplier())),
        };
    }

    emitHeroParticles(options = {}) {
        if (!this.heroParticles) return false;

        const {
            origin = new THREE.Vector3(),
            palette = [BLOB_COLORS[0]],
            direction = new THREE.Vector3(0, 0, 1),
            sourcePositions = [],
            sourceAnchors = [],
            ribbonCount = 0,
            beadCount = 0,
            ribbonEmitter = 'streamers',
            beadEmitter = 'beads',
            ribbonOptions = {},
            beadOptions = {},
        } = options;

        if (ribbonCount > 0) {
            const ribbonMethod = {
                surfaceShears: 'emitSurfaceShears',
                bridgeRibbons: 'emitBridgeRibbons',
                heroCurtain: 'emitHeroCurtain',
                streamers: 'emitStreamers',
            }[ribbonEmitter] || 'emitStreamers';
            this.heroParticles[ribbonMethod]({
                origin,
                palette,
                direction,
                sourcePositions,
                sourceAnchors,
                count: ribbonCount,
                ...ribbonOptions,
            });
        }

        if (beadCount > 0) {
            const beadMethod = {
                shockBeads: 'emitShockBeads',
                beads: 'emitBeads',
            }[beadEmitter] || 'emitBeads';
            this.heroParticles[beadMethod]({
                origin,
                palette,
                direction,
                sourcePositions,
                sourceAnchors,
                count: beadCount,
                ...beadOptions,
            });
        }

        return ribbonCount > 0 || beadCount > 0;
    }

    emitHeroLockParticles(origin, palette, direction) {
        const anchors = this.getSurfaceEmissionAnchors(origin, 2, {
            direction,
            behavior: 'surface',
            tangentBias: 0.28,
        });
        const counts = this.getHeroParticleCounts(22, 40, 1.06);
        if (counts.ribbons <= 0 && counts.beads <= 0) return;

        this.emitHeroParticles({
            origin,
            palette: [palette[0], palette[0].clone().lerp(palette[1], 0.2)],
            direction,
            sourceAnchors: anchors,
            ribbonCount: counts.ribbons,
            beadCount: counts.beads,
            ribbonEmitter: 'surfaceShears',
            ribbonOptions: {
                spread: 0.18,
                speedMin: 7,
                speedMax: 11.8,
                lifeMin: 0.16,
                lifeMax: 0.28,
                widthMin: 0.08,
                widthMax: 0.18,
                lengthMin: 1.1,
                lengthMax: 2.6,
                towardCamera: 0.22,
                lateralBias: 0.24,
            },
            beadOptions: {
                spread: 0.28,
                speedMin: 7.8,
                speedMax: 12.4,
                lifeMin: 0.2,
                lifeMax: 0.36,
                sizeMin: 0.18,
                sizeMax: 0.38,
                normalBias: 0.16,
            },
        });
    }

    emitHeroLineClearParticles(origin, band, palette, lineCount, isTetris, isBackToBack) {
        if (!this.heroParticles) return;

        const corridor = this.getStageCorridorBounds();
        const leftOrigin = new THREE.Vector3(-corridor.width * 0.46, band.y, -1.2);
        const rightOrigin = new THREE.Vector3(corridor.width * 0.46, band.y, -1.2);
        const direction = this.tmpVec3A.set(1, 0.02 + lineCount * 0.02, 0.16).normalize();
        const surfaceAnchors = this.getSurfaceEmissionAnchors(origin, isTetris ? 2 : 1, {
            direction,
            behavior: 'surface',
            tangentBias: 0.24,
        });
        const curtainAnchors = [
            this.createEmissionAnchor(leftOrigin, direction, this.tmpVec3B.set(-0.1, 0, 1), 'streamer'),
            this.createEmissionAnchor(rightOrigin, this.tmpVec3C.copy(direction).multiplyScalar(-1), this.tmpVec3D.set(0.1, 0, 1), 'streamer'),
        ].filter(Boolean);

        let baseRibbons = 42;
        let baseBeads = 34;
        if (lineCount >= 2) {
            baseRibbons = 62;
            baseBeads = 56;
        }
        if (lineCount >= 3) {
            baseRibbons = 82;
            baseBeads = 74;
        }
        if (isTetris) {
            baseRibbons = 124;
            baseBeads = 104;
        }

        const counts = this.getHeroParticleCounts(baseRibbons, baseBeads, isTetris ? 1.1 : 1.04);
        this.emitHeroParticles({
            origin,
            palette: [palette[0], palette[1], palette[0].clone().lerp(palette[2], 0.35)],
            direction,
            sourceAnchors: isTetris ? [...surfaceAnchors, ...curtainAnchors] : surfaceAnchors,
            ribbonCount: counts.ribbons,
            beadCount: counts.beads,
            ribbonEmitter: isTetris ? 'heroCurtain' : 'surfaceShears',
            beadEmitter: isTetris ? 'shockBeads' : 'beads',
            ribbonOptions: {
                spread: isTetris ? 0.56 : 0.38,
                speedMin: isTetris ? 10 : 8.6,
                speedMax: isTetris ? 18 : 14.2,
                lifeMin: isTetris ? 0.32 : 0.24,
                lifeMax: isTetris ? 0.64 : 0.48,
                widthMin: isTetris ? 0.14 : 0.1,
                widthMax: isTetris ? 0.28 : 0.2,
                lengthMin: isTetris ? 3.4 : 2.1,
                lengthMax: isTetris ? 7.8 : 4.8,
                towardCamera: isTetris ? 0.52 : 0.28,
                lateralBias: isTetris ? 0.26 : 0.16,
                sheetAxis: new THREE.Vector3(1, 0, 0),
            },
            beadOptions: {
                spread: isTetris ? 0.62 : 0.38,
                speedMin: isTetris ? 8.8 : 7.4,
                speedMax: isTetris ? 16 : 12.8,
                lifeMin: isTetris ? 0.26 : 0.2,
                lifeMax: isTetris ? 0.56 : 0.42,
                sizeMin: 0.18,
                sizeMax: isTetris ? 0.58 : 0.42,
            },
        });

        if (!isTetris || !this.shouldAllowSecondaryWakes()) return;

        this.registerTimeout(() => {
            if (!this.isActive || !this.heroParticles) return;
            const pulseCounts = this.getHeroParticleCounts(
                isBackToBack ? 82 : 64,
                isBackToBack ? 64 : 52,
                isBackToBack ? 1.02 : 0.92,
            );
            this.emitHeroParticles({
                origin,
                palette: isBackToBack
                    ? [palette[0], palette[0].clone().lerp(palette[1], 0.18)]
                    : [palette[1], palette[0], palette[2]],
                direction: this.tmpVec3B.set(1, 0.05, 0.2).normalize(),
                sourceAnchors: curtainAnchors,
                ribbonCount: pulseCounts.ribbons,
                beadCount: pulseCounts.beads,
                ribbonEmitter: 'heroCurtain',
                beadEmitter: 'shockBeads',
                ribbonOptions: {
                    spread: 0.44,
                    speedMin: 9.2,
                    speedMax: 15.2,
                    lifeMin: 0.24,
                    lifeMax: 0.52,
                    widthMin: 0.12,
                    widthMax: 0.24,
                    lengthMin: 2.5,
                    lengthMax: 6,
                    towardCamera: 0.34,
                    lateralBias: 0.18,
                    sheetAxis: new THREE.Vector3(1, 0, 0),
                },
                beadOptions: {
                    spread: 0.46,
                    speedMin: 8,
                    speedMax: 13.8,
                    lifeMin: 0.2,
                    lifeMax: 0.46,
                    sizeMin: 0.18,
                    sizeMax: 0.46,
                },
            });
        }, isBackToBack ? 120 : 105);

        if (!isBackToBack) return;

        this.registerTimeout(() => {
            if (!this.isActive || !this.heroParticles) return;
            const prestigeCounts = this.getHeroParticleCounts(58, 42, 0.88);
            this.emitHeroParticles({
                origin,
                palette: [palette[0], palette[1]],
                direction: this.tmpVec3B.set(1, 0.02, 0.24).normalize(),
                sourceAnchors: curtainAnchors,
                ribbonCount: prestigeCounts.ribbons,
                beadCount: prestigeCounts.beads,
                ribbonEmitter: 'heroCurtain',
                beadEmitter: 'shockBeads',
                ribbonOptions: {
                    spread: 0.34,
                    speedMin: 8.8,
                    speedMax: 14.8,
                    lifeMin: 0.24,
                    lifeMax: 0.56,
                    widthMin: 0.12,
                    widthMax: 0.22,
                    lengthMin: 2.8,
                    lengthMax: 6.4,
                    towardCamera: 0.26,
                    lateralBias: 0.12,
                    sheetAxis: new THREE.Vector3(1, 0, 0),
                },
                beadOptions: {
                    spread: 0.36,
                    speedMin: 7.8,
                    speedMax: 13.4,
                    lifeMin: 0.18,
                    lifeMax: 0.42,
                    sizeMin: 0.16,
                    sizeMax: 0.4,
                },
            });
        }, 220);
    }

    emitHeroComboParticles(origin, palette, direction, comboCount) {
        if (!this.heroParticles) return;

        const anchorCount = comboCount >= 7 ? 3 : 2;
        const surfaceAnchors = this.getSurfaceEmissionAnchors(origin, anchorCount, {
            direction,
            behavior: 'surface',
            tangentBias: 0.26,
        });
        const bridgeAnchors = this.getBridgeEmissionAnchors(origin, anchorCount, {
            direction,
            behavior: 'bridge',
        });

        if (comboCount <= 3) {
            const counts = this.getHeroParticleCounts(26, 20, 0.86);
            this.emitHeroParticles({
                origin,
                palette: [palette[0], this._scratchColors[2].copy(palette[0]).lerp(palette[1], 0.22)],
                direction,
                sourceAnchors: bridgeAnchors,
                ribbonCount: counts.ribbons,
                beadCount: counts.beads,
                ribbonEmitter: 'bridgeRibbons',
                ribbonOptions: {
                    spread: 0.24,
                    speedMin: 6.8,
                    speedMax: 11.2,
                    lifeMin: 0.18,
                    lifeMax: 0.32,
                    widthMin: 0.08,
                    widthMax: 0.16,
                    lengthMin: 1.2,
                    lengthMax: 2.8,
                    towardCamera: 0.22,
                    lateralBias: 0.2,
                },
                beadOptions: {
                    spread: 0.2,
                    speedMin: 6.4,
                    speedMax: 10.2,
                    lifeMin: 0.16,
                    lifeMax: 0.28,
                    sizeMin: 0.14,
                    sizeMax: 0.3,
                    normalBias: 0.1,
                },
            });
            return;
        }

        const isSurge = comboCount >= 7;
        const counts = this.getHeroParticleCounts(
            isSurge ? 144 : 92,
            isSurge ? 128 : 72,
            isSurge ? 1.14 : 1.02,
        );
        this.emitHeroParticles({
            origin,
            palette: isSurge
                ? [palette[0], palette[1], this._scratchColors[3].copy(palette[0]).lerp(palette[2], 0.24)]
                : [palette[0], palette[1], palette[2]],
            direction,
            sourceAnchors: isSurge ? [...surfaceAnchors, ...bridgeAnchors] : [...bridgeAnchors, ...surfaceAnchors],
            ribbonCount: counts.ribbons,
            beadCount: counts.beads,
            ribbonEmitter: isSurge ? 'heroCurtain' : 'bridgeRibbons',
            beadEmitter: isSurge ? 'shockBeads' : 'beads',
            ribbonOptions: {
                spread: isSurge ? 0.62 : 0.46,
                speedMin: isSurge ? 10.8 : 9,
                speedMax: isSurge ? 19.5 : 15.5,
                lifeMin: isSurge ? 0.26 : 0.22,
                lifeMax: isSurge ? 0.66 : 0.48,
                widthMin: 0.1,
                widthMax: isSurge ? 0.32 : 0.24,
                lengthMin: isSurge ? 3.8 : 2.4,
                lengthMax: isSurge ? 8.4 : 5.8,
                towardCamera: isSurge ? 0.82 : 0.52,
                lateralBias: isSurge ? 0.38 : 0.22,
            },
            beadOptions: {
                spread: isSurge ? 0.58 : 0.38,
                speedMin: isSurge ? 9.2 : 7.4,
                speedMax: isSurge ? 17.2 : 13.2,
                lifeMin: isSurge ? 0.22 : 0.18,
                lifeMax: isSurge ? 0.58 : 0.4,
                sizeMin: 0.18,
                sizeMax: isSurge ? 0.54 : 0.38,
            },
        });

        if (!isSurge) return;

        // Snapshot palette for deferred callbacks (scratch palette will be reused)
        const deferredPalette0 = palette[0].clone();
        const deferredPalette1 = palette[1].clone();
        const deferredPalette2 = palette[2].clone();

        this.registerTimeout(() => {
            if (!this.isActive || !this.heroParticles) return;
            const secondCounts = this.getHeroParticleCounts(98, 82, 0.96);
            this.emitHeroParticles({
                origin,
                palette: [deferredPalette1, deferredPalette0, this._scratchColors[4].copy(deferredPalette1).lerp(deferredPalette2, 0.2)],
                direction: this.tmpVec3C.copy(direction).multiplyScalar(0.72)
                    .add(this.tmpVec3D.set(0.12, 0.04, 0.26))
                    .normalize(),
                sourceAnchors: [...surfaceAnchors.slice(0, 2), ...bridgeAnchors.slice(0, 1)],
                ribbonCount: secondCounts.ribbons,
                beadCount: secondCounts.beads,
                ribbonEmitter: 'heroCurtain',
                beadEmitter: 'shockBeads',
                ribbonOptions: {
                    spread: 0.54,
                    speedMin: 10,
                    speedMax: 17.2,
                    lifeMin: 0.24,
                    lifeMax: 0.52,
                    widthMin: 0.1,
                    widthMax: 0.24,
                    lengthMin: 3,
                    lengthMax: 6.8,
                    towardCamera: 0.72,
                    lateralBias: 0.26,
                },
                beadOptions: {
                    spread: 0.5,
                    speedMin: 8.4,
                    speedMax: 14.6,
                    lifeMin: 0.2,
                    lifeMax: 0.46,
                    sizeMin: 0.18,
                    sizeMax: 0.46,
                },
            });
        }, 110);

        this.registerTimeout(() => {
            if (!this.isActive || !this.heroParticles) return;
            const thirdCounts = this.getHeroParticleCounts(72, 58, 0.72);
            this.emitHeroParticles({
                origin,
                palette: [deferredPalette0, deferredPalette2, deferredPalette1],
                direction: this.tmpVec3A.copy(direction).multiplyScalar(0.6)
                    .add(this.tmpVec3B.set(-0.1, 0.06, 0.3))
                    .normalize(),
                sourceAnchors: [...bridgeAnchors.slice(0, 2), ...surfaceAnchors.slice(0, 1)],
                ribbonCount: thirdCounts.ribbons,
                beadCount: thirdCounts.beads,
                ribbonEmitter: 'heroCurtain',
                beadEmitter: 'shockBeads',
                ribbonOptions: {
                    spread: 0.46,
                    speedMin: 9.2,
                    speedMax: 15.6,
                    lifeMin: 0.2,
                    lifeMax: 0.44,
                    widthMin: 0.1,
                    widthMax: 0.22,
                    lengthMin: 2.4,
                    lengthMax: 5.8,
                    towardCamera: 0.58,
                    lateralBias: 0.24,
                },
                beadOptions: {
                    spread: 0.42,
                    speedMin: 7.8,
                    speedMax: 13.4,
                    lifeMin: 0.18,
                    lifeMax: 0.4,
                    sizeMin: 0.16,
                    sizeMax: 0.4,
                },
            });
        }, 220);
    }

    updateCameraResponse() {
        if (!this.camera) return;

        const heat = this.fxState.stageHeat || 0;
        const heroMoment = Math.min(
            1,
            this.fxState.lockImpact * 0.22
                + this.fxState.lineSurge * 0.4
                + this.fxState.comboPeak * 0.48
                + this.fxState.surgeState * 0.7,
        );
        const beatPulse = this.fxState.beatPulse || 0;
        const actProgress = this.fxState.actProgress || 0;
        const dangerLevel = this.fxState.dangerLevel || 0;
        const rewardPulse = this.fxState.rewardPulse || 0;
        const overdrivePulse = this.fxState.overdrivePulse || 0;
        const targetX = this.fxState.hasImpactOrigin
            ? THREE.MathUtils.clamp(this.fxState.impactOrigin.x / Math.max(this.screenBounds.width, 1), -1, 1)
            : 0;
        const targetY = this.fxState.hasImpactOrigin
            ? THREE.MathUtils.clamp(this.fxState.impactOrigin.y / Math.max(this.screenBounds.height, 1), -1, 1)
            : 0;

        this.tmpVec3E.set(
            this.baseCameraPosition.x + targetX * (-0.9 - heroMoment * 0.6) + Math.sin(this.time * 0.22) * beatPulse * 0.08,
            this.baseCameraPosition.y + targetY * (-0.55 - heroMoment * 0.3) + Math.cos(this.time * 0.18) * beatPulse * 0.06 + dangerLevel * 0.16,
            this.baseCameraPosition.z - heat * 2.2 - heroMoment * 3.2 - actProgress * 0.6 - rewardPulse * 0.6 - overdrivePulse * 0.8 + dangerLevel * 0.5,
        );
        this.camera.position.lerp(this.tmpVec3E, 0.06);
        this.camera.fov += ((
            this.baseCameraFov
            - heat * 0.72
            - heroMoment * 1.8
            - beatPulse * 0.28
            - actProgress * 0.15
            + dangerLevel * 0.82
            - rewardPulse * 0.22
            - overdrivePulse * 0.34
        ) - this.camera.fov) * 0.05;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(this.baseCameraLookAt);
    }

    handlePieceLockEvent(data = {}) {
        if (!this.isActive) return;

        this.ensureStageSystems();
        const pieceColor = this.getEventColorFromPiece(data?.piece);
        const origin = this.getStageOriginFromPiece(data?.piece);
        const direction = this.tmpVec3A.set(origin.x * 0.04, origin.y * 0.015 + 0.08, 1).normalize();
        const palette = this.createAccentPalette(pieceColor, BLOB_COLORS[(Math.floor(this.time * 2) + 2) % BLOB_COLORS.length]);
        this.stageConductor?.noteAccent?.(palette[0], 0.38);
        this.stageConductor?.registerPieceLock?.();
        this.boardHaloController?.triggerPieceLock?.(palette[0], palette[1]);

        this.setImpactOrigin(origin, direction);
        this.addStageHeat(0.1);
        this.addDanger(0.11, origin.y);
        this.fxState.lockImpact = Math.max(this.fxState.lockImpact, 0.92);
        this.fxState.bloomBoost = Math.max(this.fxState.bloomBoost, 0.18);
        this.fxState.chromaPulse = Math.max(this.fxState.chromaPulse, 0.08);
        this.fxState.vignettePulse = Math.max(this.fxState.vignettePulse, 0.025);
        this.fxState.shockwaveStrength = Math.max(this.fxState.shockwaveStrength, 0.22);
        this.fxState.rewardPulse = Math.max(this.fxState.rewardPulse, 0.12);
        this.updateStageState();

        this.targetPulse = Math.min(this.targetPulse + 0.12, 0.72);
        this.glowFlash = Math.max(this.glowFlash, 0.16);
        this.comboIntensity = Math.max(this.comboIntensity, 0.14);
        this.comboColorFlash = Math.max(this.comboColorFlash, 0.07);
        this.comboScaleBoost = Math.max(this.comboScaleBoost, 0.06);
        this.comboSpeedBoost = Math.max(this.comboSpeedBoost, 1.08);

        this.applyBlobReaction(origin, {
            strength: 0.78,
            flowStrength: 0.56,
            accentColor: pieceColor,
            affectedCount: 2,
            echoStrength: 0.18,
            direction,
        });

        this.spawnGameplaySparkBurst({
            origin,
            count: this.getScaledParticleCount(GAMEPLAY_SPARK_CONFIG.lockMin, GAMEPLAY_SPARK_CONFIG.lockMax, 0.65),
            life: 0.62,
            intensity: 0.96,
            size: 0.56,
            palette,
            direction,
            pattern: 'lock',
        });
        this.emitHeroLockParticles(origin, palette, direction);

        this.queueBlobBurst({
            fragments: Math.round(THREE.MathUtils.lerp(12, 18, this.getDropletMultiplier())),
            strength: 0.4,
            sourceCount: 1,
            origin,
        });
    }

    handleLineClearEvent(data = {}) {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        if (!this.isActive || settings?.backgroundComboEffects !== true) return;

        this.ensureStageSystems();
        const lineCount = data?.lineCount || 1;
        const isTetris = lineCount >= 4;
        const isBackToBack = Boolean(data?.backToBack || data?.isBackToBack);
        const band = this.getLineBandData(data);
        const origin = this.getStageOriginFromScreenPosition(data?.position) || this._scratchOriginVec.set(0, band.y, -0.9);
        const accentColor = isTetris
            ? this.getColorFromValue('#ff66f0', 0xff66f0, this._scratchColors[1])
            : this._scratchColors[1].copy(BLOB_COLORS[(lineCount + Math.floor(this.time * 1.5)) % BLOB_COLORS.length]);
        const direction = this.tmpVec3A.set(0, 0.03 + lineCount * 0.015, 1).normalize();
        const palette = this.createAccentPalette(accentColor, BLOB_COLORS[(lineCount + 3) % BLOB_COLORS.length]);
        this.stageConductor?.noteAccent?.(palette[0], isTetris ? 0.52 : 0.34);
        this.stageConductor?.registerLineClear?.({
            lineCount,
            level: data?.level,
            isTetris,
        });
        this.boardHaloController?.triggerLineClear?.({
            primary: palette[0],
            secondary: palette[1],
            lineCount,
            bandY: band.y,
            bandHeight: band.height,
            isTetris,
            isBackToBack,
        });

        this.setImpactOrigin(origin, direction);
        this.addStageHeat(isTetris ? 0.3 : 0.13 + lineCount * 0.04);
        this.relieveDanger(isTetris ? 0.32 : 0.1 + lineCount * 0.05);
        this.fxState.lineSurge = Math.max(this.fxState.lineSurge, isTetris ? 1.2 : 0.55 + lineCount * 0.14);
        this.fxState.comboPeak = Math.max(this.fxState.comboPeak, 0.18 + lineCount * 0.12);
        this.fxState.bloomBoost = Math.max(this.fxState.bloomBoost, isTetris ? 0.38 : 0.20 + lineCount * 0.04);
        this.fxState.chromaPulse = Math.max(this.fxState.chromaPulse, isTetris ? 0.22 : 0.10 + lineCount * 0.025);
        this.fxState.vignettePulse = Math.max(this.fxState.vignettePulse, 0.035 + lineCount * 0.018);
        this.fxState.shockwaveStrength = Math.max(this.fxState.shockwaveStrength, isTetris ? 0.70 : 0.32 + lineCount * 0.10);
        this.fxState.exposureDip = Math.max(this.fxState.exposureDip, isTetris ? 0.28 : 0.14 + lineCount * 0.03);
        this.fxState.rewardPulse = Math.max(this.fxState.rewardPulse, isTetris ? 0.78 : 0.36 + lineCount * 0.08);
        this.fxState.overdrivePulse = Math.max(this.fxState.overdrivePulse, isTetris ? 0.34 : 0.1 + lineCount * 0.04);
        this.fxState.lineBandY = band.y;
        this.fxState.lineBandHeight = band.height;
        this.fxState.lastLineCount = lineCount;
        this.updateStageState();

        this.comboIntensity = Math.max(this.comboIntensity, 0.22 + lineCount * 0.1);
        this.comboColorFlash = Math.max(this.comboColorFlash, 0.1 + lineCount * 0.05);
        this.comboScaleBoost = Math.max(this.comboScaleBoost, 0.08 + lineCount * 0.034);
        this.comboSpeedBoost = Math.max(this.comboSpeedBoost, 1.12 + lineCount * 0.06);
        this.targetPulse = Math.min(this.targetPulse + 0.16 + lineCount * 0.05, 1.06);
        this.glowFlash = Math.max(this.glowFlash, 0.18 + lineCount * 0.05);

        this.applyBlobReaction(origin, {
            strength: isTetris ? 1.04 : 0.72 + lineCount * 0.06,
            flowStrength: isTetris ? 1.12 : 0.7,
            accentColor,
            affectedCount: isTetris ? 4 : 3,
            echoStrength: isTetris ? 0.54 : 0.32,
            direction,
        });

        let sparkCount = this.getScaledParticleCount(
            GAMEPLAY_SPARK_CONFIG.lineMultiMin,
            GAMEPLAY_SPARK_CONFIG.lineMultiMax,
            lineCount / 4,
        );
        if (isTetris) {
            sparkCount = this.getScaledParticleCount(
                GAMEPLAY_SPARK_CONFIG.tetrisMin,
                GAMEPLAY_SPARK_CONFIG.tetrisMax,
                0.78,
            );
        } else if (lineCount === 1) {
            sparkCount = this.getScaledParticleCount(
                GAMEPLAY_SPARK_CONFIG.lineSingleMin,
                GAMEPLAY_SPARK_CONFIG.lineSingleMax,
                0.42,
            );
        }

        this.spawnGameplaySparkBurst({
            origin,
            count: sparkCount,
            life: isTetris ? 0.96 : 0.68 + lineCount * 0.05,
            intensity: isTetris ? 1.24 : 0.98 + lineCount * 0.02,
            size: isTetris ? 0.72 : 0.58 + lineCount * 0.02,
            palette,
            direction,
            pattern: 'line',
        });
        this.emitHeroLineClearParticles(origin, band, palette, lineCount, isTetris, isBackToBack);

        // Snapshot palette/accent for deferred callbacks (scratch objects will be reused)
        const deferredAccent = accentColor.clone();
        const deferredP0 = palette[0].clone();
        const deferredP1 = palette[1].clone();
        const deferredP2 = palette[2].clone();

        this.spawnLineWake({
            y: band.y,
            height: band.height,
            intensity: isTetris ? 1.28 : 0.94 + lineCount * 0.08,
            life: isTetris ? LINE_WAKE_CONFIG.tetrisLife : LINE_WAKE_CONFIG.baseLife,
            color: accentColor,
        });

        if (this.shouldAllowSecondaryWakes()) {
            this.registerTimeout(() => {
                if (!this.isActive) return;
                this.spawnLineWake({
                    y: band.y,
                    height: band.height * (isTetris ? 0.92 : 0.8),
                    intensity: isTetris ? 0.84 : 0.6,
                    life: isTetris ? LINE_WAKE_CONFIG.baseLife : LINE_WAKE_CONFIG.baseLife * 0.92,
                    color: deferredP1 || deferredAccent,
                });
            }, isTetris ? 90 : 72);
        }

        if (isTetris && this.shouldAllowSecondaryWakes()) {
            this.registerTimeout(() => {
                if (!this.isActive) return;
                this.spawnLineWake({
                    y: band.y,
                    height: band.height * 0.74,
                    intensity: isBackToBack ? 1.02 : 0.72,
                    life: LINE_WAKE_CONFIG.baseLife,
                    color: isBackToBack ? deferredAccent : deferredP2,
                });
            }, 170);
        }

        if ((isTetris || lineCount >= 3) && this.shouldAllowSecondaryWakes()) {
            this.registerTimeout(() => {
                if (!this.isActive) return;
                this.spawnGameplaySparkBurst({
                    origin,
                    count: isTetris
                        ? this.getScaledParticleCount(92, 152, isBackToBack ? 0.94 : 0.82, 0.82)
                        : this.getScaledParticleCount(54, 90, 0.72, 0.76),
                    life: isTetris ? 0.76 : 0.64,
                    intensity: isTetris ? 1.08 : 0.92,
                    size: isTetris ? 0.64 : 0.5,
                    palette: [deferredP1, deferredP0, deferredP2],
                    direction: this.tmpVec3B.set((Math.random() - 0.5) * 0.16, 0.08, 1).normalize(),
                    pattern: 'line',
                });
            }, isTetris ? 128 : 104);
        }

        let dropletFragments = 7;
        if (isTetris) {
            dropletFragments = 24;
        } else if (lineCount >= 3) {
            dropletFragments = 10;
        }

        this.queueBlobBurst({
            fragments: Math.round(dropletFragments * this.getDropletMultiplier()),
            strength: isTetris ? 0.82 : 0.46 + lineCount * 0.09,
            sourceCount: isTetris || lineCount >= 3 ? 2 : 1,
            origin,
        });
    }

    handleComboEvent(data = {}) {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        if (!this.isActive || settings?.backgroundComboEffects !== true) return;

        this.ensureStageSystems();
        const comboCount = Math.max(1, data?.comboCount || 1);
        const origin = this.getStageOriginFromScreenPosition(data?.position) || this.getComboOrigin();
        const accentColor = this._scratchColors[1].copy(BLOB_COLORS[(comboCount + Math.floor(this.time * 2.3)) % BLOB_COLORS.length]);
        const direction = this.tmpVec3A.set(origin.x * 0.02, origin.y * 0.01 + 0.1, 1).normalize();
        const palette = this.createAccentPalette(accentColor, BLOB_COLORS[(comboCount + 1) % BLOB_COLORS.length]);
        this.stageConductor?.noteAccent?.(palette[0], comboCount >= 7 ? 0.6 : 0.34);
        this.stageConductor?.registerCombo?.(comboCount);
        this.boardHaloController?.triggerCombo?.(palette[0], palette[1], comboCount);

        this.setImpactOrigin(origin, direction);
        this.fxState.lastComboCount = comboCount;
        let comboHeat = 0.08;
        if (comboCount >= 7) {
            comboHeat = 0.28;
        } else if (comboCount >= 4) {
            comboHeat = 0.18;
        }
        this.addStageHeat(comboHeat);
        this.relieveDanger(comboCount >= 7 ? 0.18 : (comboCount >= 4 ? 0.1 : 0.04));

        this.comboIntensity = Math.max(this.comboIntensity, Math.min(0.18 + comboCount * 0.1, 1.1));
        this.comboColorFlash = Math.max(this.comboColorFlash, Math.min(0.08 + comboCount * 0.04, 0.44));
        this.comboScaleBoost = Math.max(this.comboScaleBoost, Math.min(0.04 + comboCount * 0.045, 0.36));
        this.comboSpeedBoost = Math.max(this.comboSpeedBoost, Math.min(1.04 + comboCount * 0.08, 1.85));
        this.targetPulse = Math.min(this.targetPulse + 0.08 + comboCount * 0.03, 1.1);
        this.glowFlash = Math.max(this.glowFlash, Math.min(0.12 + comboCount * 0.05, 0.8));
        this.fxState.rewardPulse = Math.max(this.fxState.rewardPulse, Math.min(0.18 + comboCount * 0.08, 0.92));
        this.updateStageState();

        if (comboCount <= 3) {
            this.fxState.comboCharge = Math.max(this.fxState.comboCharge, 0.22 + comboCount * 0.09);
            this.fxState.bloomBoost = Math.max(this.fxState.bloomBoost, 0.06 + comboCount * 0.02);
            this.applyBlobReaction(origin, {
                strength: 0.34 + comboCount * 0.05,
                flowStrength: 0.42,
                accentColor,
                affectedCount: 1,
                echoStrength: 0.18,
                direction,
            });

            this.spawnGameplaySparkBurst({
                origin,
                count: this.getScaledParticleCount(
                    GAMEPLAY_SPARK_CONFIG.comboChargeMin,
                    GAMEPLAY_SPARK_CONFIG.comboChargeMax,
                    comboCount / 3,
                ),
                life: 0.6 + comboCount * 0.04,
                intensity: 0.9,
                size: 0.46,
                palette,
                direction,
                pattern: 'combo',
            });
            this.emitHeroComboParticles(origin, palette, direction, comboCount);
            return;
        }

        this.fxState.comboCharge = Math.max(this.fxState.comboCharge, 0.34 + comboCount * 0.06);
        this.fxState.comboPeak = Math.max(this.fxState.comboPeak, comboCount >= 7 ? 0.82 : 0.38 + comboCount * 0.08);
        this.fxState.bloomBoost = Math.max(this.fxState.bloomBoost, comboCount >= 7 ? 0.26 : 0.14);
        this.fxState.chromaPulse = Math.max(this.fxState.chromaPulse, comboCount >= 7 ? 0.18 : 0.09);
        this.fxState.vignettePulse = Math.max(this.fxState.vignettePulse, comboCount >= 7 ? 0.1 : 0.055);
        this.fxState.shockwaveStrength = Math.max(this.fxState.shockwaveStrength, comboCount >= 7 ? 0.4 : 0.22);
        this.fxState.exposureDip = Math.max(this.fxState.exposureDip, comboCount >= 7 ? 0.2 : 0.1);

        if (comboCount >= 7) {
            this.fxState.surgeState = Math.max(this.fxState.surgeState, 0.78);
            this.fxState.overdrivePulse = Math.max(this.fxState.overdrivePulse, 0.72);
        } else if (comboCount >= 4) {
            this.fxState.overdrivePulse = Math.max(this.fxState.overdrivePulse, 0.28);
        }

        this.applyBlobReaction(origin, {
            strength: comboCount >= 7 ? 1.08 : 0.72 + comboCount * 0.04,
            flowStrength: comboCount >= 7 ? 1.18 : 0.84,
            accentColor,
            affectedCount: comboCount >= 7 ? 4 : 3,
            echoStrength: comboCount >= 7 ? 0.58 : 0.34,
            direction,
        });

        this.spawnGameplaySparkBurst({
            origin,
            count: comboCount >= 7
                ? this.getScaledParticleCount(GAMEPLAY_SPARK_CONFIG.comboSurgeMin, GAMEPLAY_SPARK_CONFIG.comboSurgeMax, Math.min(comboCount / 10, 1))
                : this.getScaledParticleCount(GAMEPLAY_SPARK_CONFIG.comboRuptureMin, GAMEPLAY_SPARK_CONFIG.comboRuptureMax, Math.min(comboCount / 6, 1)),
            life: comboCount >= 7 ? 1.0 : 0.8,
            intensity: comboCount >= 7 ? 1.28 : 1.02,
            size: comboCount >= 7 ? 0.82 : 0.62,
            palette,
            direction,
            pattern: 'combo',
        });
        this.emitHeroComboParticles(origin, palette, direction, comboCount);

        this.spawnLineWake({
            y: origin.y,
            height: comboCount >= 7 ? 0.22 : 0.16,
            intensity: comboCount >= 7 ? 0.7 : 0.48,
            life: comboCount >= 7 ? 0.62 : 0.46,
            color: accentColor,
        });

        // Snapshot palette for deferred callbacks (scratch objects will be reused)
        const comboDeferP0 = palette[0].clone();
        const comboDeferP1 = palette[1].clone();
        const comboDeferP2 = palette[2].clone();

        if (comboCount >= 4 && this.shouldAllowSecondaryWakes()) {
            this.registerTimeout(() => {
                if (!this.isActive) return;
                this.spawnGameplaySparkBurst({
                    origin,
                    count: comboCount >= 7
                        ? this.getScaledParticleCount(88, 138, 0.84, 0.82)
                        : this.getScaledParticleCount(54, 88, 0.72, 0.76),
                    life: comboCount >= 7 ? 0.8 : 0.66,
                    intensity: comboCount >= 7 ? 1.12 : 0.92,
                    size: comboCount >= 7 ? 0.68 : 0.52,
                    palette: [comboDeferP1, comboDeferP0, comboDeferP2],
                    direction: this.tmpVec3C.copy(direction).multiplyScalar(0.7).add(this.tmpVec3D.set(0.08, 0.05, 0.3)).normalize(),
                    pattern: 'combo',
                });
            }, comboCount >= 7 ? 110 : 90);
        }

        if (comboCount >= 7) {
            const heroTarget = this.blobs.find((blob) => blob.tier === 'hero' && blob.homePosition.distanceTo(origin) > 2.5);
            if (heroTarget) {
                this.spawnGameplaySparkBurst({
                    origin: heroTarget.homePosition,
                    count: this.getScaledParticleCount(72, 116, 0.88, 0.82),
                    life: 0.92,
                    intensity: 1.16,
                    size: 0.72,
                    palette: [comboDeferP1, comboDeferP2, comboDeferP0],
                    direction: this.tmpVec3B.set(heroTarget.homePosition.x * -0.03, 0.16, 1).normalize(),
                    pattern: 'combo',
                });
            }

            if (this.shouldAllowSecondaryWakes()) {
                this.registerTimeout(() => {
                    if (!this.isActive) return;
                    this.spawnGameplaySparkBurst({
                        origin,
                        count: this.getScaledParticleCount(96, 148, 0.8, 0.78),
                        life: 0.76,
                        intensity: 1.08,
                        size: 0.64,
                        palette: [comboDeferP2, comboDeferP0, comboDeferP1],
                        direction: this.tmpVec3A.copy(direction).multiplyScalar(0.58)
                            .add(this.tmpVec3B.set(-0.14, 0.08, 0.32))
                            .normalize(),
                        pattern: 'combo',
                    });
                }, 210);
            }
        }

        this.queueBlobBurst({
            fragments: Math.round((comboCount >= 7 ? 24 : 16) * this.getDropletMultiplier()),
            strength: comboCount >= 7 ? 0.86 : Math.min(0.5 + comboCount * 0.055, 0.72),
            sourceCount: comboCount >= 7 ? 2 : 1,
            origin,
        });
    }

    handleLevelUpEvent(data = {}) {
        if (!this.isActive) return;
        this.ensureStageSystems();

        const accent = BLOB_COLORS[(Math.floor(this.time * 1.7) + 5) % BLOB_COLORS.length].clone();
        const support = BLOB_COLORS[(Math.floor(this.time * 1.7) + 2) % BLOB_COLORS.length].clone();
        this.stageConductor?.noteAccent?.(accent, 0.42);
        this.stageConductor?.registerLevelUp?.(data?.level ?? data?.currentLevel ?? null);
        this.boardHaloController?.triggerLevelUp?.(accent, support);
        this.fxState.bloomBoost = Math.max(this.fxState.bloomBoost, 0.1);
        this.fxState.vignettePulse = Math.max(this.fxState.vignettePulse, 0.04);
        this.addStageHeat(0.08);
        this.updateStageState();
    }

    handleMicroGameplayEvent(type, data = {}) {
        if (!this.isActive) return;
        this.ensureStageSystems();

        let intensity = 0.12;
        if (type === 'rotate') intensity = 0.16;
        else if (type === 'hard-drop') intensity = 0.22;
        else if (type === 'hold') intensity = 0.2;

        const accent = data?.piece
            ? this.getEventColorFromPiece(data.piece)
            : this.fxState.dominantAccent.clone();
        this.stageConductor?.noteAccent?.(accent, 0.18);
        this.stageConductor?.registerMicroEvent?.(intensity);
        this.boardHaloController?.triggerMicro?.(accent, this.fxState.supportAccent, intensity);
        this.fxState.boardHaloEnergy = Math.max(this.fxState.boardHaloEnergy, intensity * 0.8);
        if (type === 'hard-drop') {
            this.fxState.lockImpact = Math.max(this.fxState.lockImpact, 0.18);
        }
    }

    decayFxState(delta) {
        // Linear approximation: x * decay^fs ≈ x * (1 - (1-decay)*fs) — avoids 11 Math.pow calls
        // Clamped to >= 0 to prevent sign-flip during frame spikes (fs > 1/(1-decay))
        const fs = Math.max(0.35, delta * 60);
        const d = (decay) => Math.max(0, 1 - (1 - decay) * fs);
        this.fxState.lockImpact *= d(FX_DECAY.lockImpact);
        this.fxState.lineSurge *= d(FX_DECAY.lineSurge);
        this.fxState.comboCharge *= d(FX_DECAY.comboCharge);
        this.fxState.comboPeak *= d(FX_DECAY.comboPeak);
        this.fxState.surgeState *= d(FX_DECAY.surgeState);
        this.fxState.stageHeat *= d(FX_DECAY.stageHeat);
        this.fxState.bloomBoost *= d(FX_DECAY.bloomBoost);
        this.fxState.chromaPulse *= d(FX_DECAY.chromaPulse);
        this.fxState.vignettePulse *= d(FX_DECAY.vignettePulse);
        this.fxState.shockwaveStrength *= d(FX_DECAY.shockwaveStrength);
        this.fxState.exposureDip *= d(FX_DECAY.exposureDip);
        this.fxState.dangerLevel *= d(FX_DECAY.dangerLevel);
        this.fxState.rewardPulse *= d(FX_DECAY.rewardPulse);
        this.fxState.overdrivePulse *= d(FX_DECAY.overdrivePulse);
        this.fxState.lineBandHeight += (0.18 - this.fxState.lineBandHeight) * 0.06;
        this.updateStageState();

        if (
            this.fxState.lockImpact < 0.01
            && this.fxState.lineSurge < 0.01
            && this.fxState.comboCharge < 0.01
            && this.fxState.comboPeak < 0.01
            && this.fxState.surgeState < 0.01
        ) {
            this.fxState.hasImpactOrigin = false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────
    setupEventListeners() {
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            this.handlePieceLockEvent(data);
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            this.handleComboEvent(data);
        });

        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            this.handleLineClearEvent(data);
        });

        const pieceMoveUnsub = eventBus.on(EVENTS.PIECE_MOVE, (data) => {
            this.handleMicroGameplayEvent('move', data);
        });

        const pieceRotateUnsub = eventBus.on(EVENTS.PIECE_ROTATE, (data) => {
            this.handleMicroGameplayEvent('rotate', data);
        });

        const hardDropUnsub = eventBus.on(EVENTS.HARD_DROP, (data) => {
            this.handleMicroGameplayEvent('hard-drop', data);
        });

        const levelUpUnsub = eventBus.on(EVENTS.LEVEL_UP, (data) => {
            this.handleLevelUpEvent(data);
        });

        this.eventUnsubscribers.push(
            pieceLockUnsub,
            comboUnsub,
            lineClearUnsub,
            pieceMoveUnsub,
            pieceRotateUnsub,
            hardDropUnsub,
            levelUpUnsub,
        );
        if (!this.boundResizeHandler) {
            this.boundResizeHandler = () => this.resize(window.innerWidth, window.innerHeight);
        }
        if (!this.boundVisibilityHandler) {
            this.boundVisibilityHandler = () => {
                if (!document.hidden) {
                    this.stageConductor?.syncTrackMeta?.(true);
                    this.scheduleDeferredEffects(40);
                    this.scheduleBurstPoolPrewarm(180);
                }
            };
        }
        this.registerEventListener(window, 'resize', this.boundResizeHandler);
        this.registerEventListener(document, 'visibilitychange', this.boundVisibilityHandler);
    }

    updateStageSystems(delta) {
        this.ensureStageSystems();
        if (!this.stageConductor || !this.boardHaloController) return;

        this.conductorChannels = this.stageConductor.update(delta, this.fxState);
        this.fxState.actIndex = this.conductorChannels.actIndex;
        this.fxState.actProgress = this.conductorChannels.actProgress;
        this.fxState.beatPulse = this.conductorChannels.beatPulse;
        this.fxState.barPhase = this.conductorChannels.barPhase;
        this.fxState.phrasePhase = this.conductorChannels.phrasePhase;
        this.fxState.boardHaloEnergy = this.conductorChannels.boardHaloEnergy;
        this.fxState.fieldTakeover = this.conductorChannels.fieldTakeover;
        this.fxState.heroWindow = this.conductorChannels.heroWindow;
        this.fxState.dominantAccent.copy(this.conductorChannels.dominantAccent);
        this.fxState.supportAccent.copy(this.conductorChannels.supportAccent);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    // Try/catch helpers kept out of the hot animate body so V8 can fully
    // optimize the per-frame math. Each helper isolates a failure-prone
    // GPU call and its recovery path.
    _safeCompute() {
        try {
            this.renderer.compute(this.sparkCompute.computeNode);
        } catch (error) {
            this.rebuildSparksWithoutCompute(error).catch((rebuildError) => {
                console.warn('[ElectricDreams] Spark fallback rebuild failed:', rebuildError);
            });
        }
    }

    _safeRender(renderStartMs) {
        if (this.flags.usePost && this.postPipeline?.isEnabled()) {
            try {
                this.postPipeline.render();
                return this.postPipeline.lastRenderCostMs || 0;
            } catch (error) {
                this.handlePostRenderFailure(error);
                this.renderer.render(this.scene, this.camera);
                return 0;
            }
        }
        if (this.flags.usePost && this.composer) {
            try {
                this.composer.render();
                return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - renderStartMs;
            } catch (error) {
                this.handlePostRenderFailure(error);
                this.renderer.render(this.scene, this.camera);
                return 0;
            }
        }
        this.renderer.render(this.scene, this.camera);
        return 0;
    }

    startAnimation() {
        if (typeof this.animate !== 'function') {
            this.animate = this.safeAnimate(() => {
                const frameStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const rawDelta = this.clock.getDelta();
                const delta = Number.isFinite(rawDelta) ? Math.min(rawDelta, 0.05) : 0.016;
                this.time += delta;

                // ── Progressive blob loading (Step 1) ──
                if (!this.blobLoadingComplete) {
                    this.loadNextBlobBatch(4);
                }

                this.frameCount += 1;

                // Reset per-frame burst counter and drain at most one queued burst.
                // This spreads combo cascades (3-4 simultaneous bursts) across multiple
                // frames so we never have to do all their CPU+GPU work in a single frame.
                this._burstsThisFrame = 0;
                if (this._burstQueue.length > 0) {
                    const queued = this._burstQueue.shift();
                    this.spawnGameplaySparkBurst(queued);
                }

                const heroParticleActivity = this.heroParticles?.getActivity?.() || 0;

                // Decay effects
                this.pulseIntensity += (this.targetPulse - this.pulseIntensity) * 0.05;
                this.targetPulse *= 0.99;
                this.glowFlash *= 0.92;
                this.comboIntensity *= 0.97;
                this.comboColorFlash *= 0.94;
                this.comboScaleBoost *= 0.96;
                this.comboSpeedBoost = 1.0 + (this.comboSpeedBoost - 1.0) * 0.95;
                this.decayFxState(delta);
                this.updateStageSystems(delta);

                // Dynamic bloom (reuses cached _dynPostParams object to avoid per-frame alloc)
                if (this.flags.usePost && this.postPipeline) {
                    const adaptivePost = this.getAdaptivePostParams();
                    const fx = this.fxState;
                    const dangerLevel = fx.dangerLevel || 0;
                    const rewardPulse = fx.rewardPulse || 0;
                    const overdrivePulse = fx.overdrivePulse || 0;
                    const stageHeat = fx.stageHeat || 0;
                    const beatPulse = fx.beatPulse || 0;
                    const surgeState = fx.surgeState || 0;
                    const lineSurge = fx.lineSurge || 0;
                    const comboBloomBoost = this.comboIntensity * 0.14
                        + fx.comboCharge * 0.10
                        + fx.comboPeak * 0.22
                        + surgeState * 0.28
                        + lineSurge * 0.10
                        + stageHeat * 0.04
                        + beatPulse * 0.03
                        + heroParticleActivity * 0.28
                        + fx.bloomBoost
                        + rewardPulse * 0.12
                        + overdrivePulse * 0.18;
                    const profile = this.postProfile;
                    const dp = this._dynPostParams;
                    dp.time = this.time;
                    dp.bloomStrength = this.baseBloomStrength + this.glowFlash * 0.08 + comboBloomBoost;
                    dp.godRayStrength = (adaptivePost?.godRayStrength ?? profile?.godRayStrength ?? 0)
                        + this.comboIntensity * 0.032
                        + lineSurge * 0.048
                        + surgeState * 0.08
                        + stageHeat * 0.014
                        + overdrivePulse * 0.032;
                    dp.chromaticStrength = (adaptivePost?.chromaticStrength ?? profile?.chromaticStrength ?? 0)
                        + fx.chromaPulse * 0.012
                        + beatPulse * 0.003
                        + heroParticleActivity * 0.008
                        + stageHeat * 0.0012
                        + dangerLevel * 0.004;
                    dp.vignetteDarkness = (profile?.vignetteDarkness ?? 0.42)
                        + fx.actProgress * 0.02
                        + fx.vignettePulse * 0.14
                        + heroParticleActivity * 0.02
                        + stageHeat * 0.025
                        + dangerLevel * 0.16;
                    dp.shockwaveStrength = fx.shockwaveStrength * 0.09;
                    dp.shockwaveCenter = fx.impactScreen;
                    dp.exposure = (profile?.exposure ?? 0.93)
                        - fx.exposureDip * 0.06
                        + beatPulse * 0.005
                        - heroParticleActivity * 0.014
                        + surgeState * 0.01
                        - dangerLevel * 0.026
                        + rewardPulse * 0.01;
                    // Glass rim: pulse slightly with combo peak so the edge tint
                    // breathes during high-energy moments without being noisy.
                    dp.glassRimStrength = (profile?.glassRimStrength ?? 0)
                        + fx.comboPeak * 0.08
                        + surgeState * 0.04;
                    this.postPipeline.updateDynamic(dp);
                } else if (this.flags.usePost && this.bloomPass) {
                    const rewardPulse = this.fxState.rewardPulse || 0;
                    const comboBloomBoost = this.comboIntensity * 0.1
                        + this.fxState.comboPeak * 0.12
                        + heroParticleActivity * 0.12
                        + this.fxState.bloomBoost
                        + this.fxState.lineSurge * 0.04
                        + rewardPulse * 0.08;
                    const targetBloom = this.baseBloomStrength + this.glowFlash * 0.08 + comboBloomBoost;
                    this.bloomPass.strength += (targetBloom - this.bloomPass.strength) * 0.08;
                    this.targetBloom += (this.baseBloomStrength - this.targetBloom) * 0.02;
                }

                this.flushQueuedBlobBurst();

                // Update blobs
                const blobStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                this.updateBlobs(delta);
                this.updateBurstBlobs(delta);
                const blobUpdateMs = (
                    typeof performance !== 'undefined' ? performance.now() : Date.now()
                ) - blobStartMs;

                // Update sparks
                const sparkStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                this.updateSparks(delta);
                const sparkUpdateMs = (
                    typeof performance !== 'undefined' ? performance.now() : Date.now()
                ) - sparkStartMs;

                // Update background
                this.updateBackground();
                this.updateBoardHalo(delta);

                // Update glass
                if (this.glassUniforms) {
                    this.glassUniforms.uTime.value = this.time;
                }

                // Update core light
                this.updateCoreLight();
                this.updateCameraResponse();

                // GPU compute (try/catch lives in helper so V8 can optimize this body)
                let computeMs = 0;
                if (this.sparkCompute && this.flags.useCompute) {
                    const computeStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    this._safeCompute();
                    computeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - computeStartMs;
                }

                // Render
                const renderStartMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const postMs = this._safeRender(renderStartMs);
                const renderMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - renderStartMs;
                const frameMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - frameStartMs;

                this.recordPerformanceMetric('blobUpdateMs', blobUpdateMs);
                this.recordPerformanceMetric('sparkUpdateMs', sparkUpdateMs);
                this.recordPerformanceMetric('computeMs', computeMs);
                this.recordPerformanceMetric('postMs', postMs);
                this.recordPerformanceMetric('renderMs', renderMs);
                this.recordPerformanceMetric('frameMs', frameMs);
                this.maybeLogWarmupSummary();
                this.updateAdaptiveBudgets(frameMs);
            }, { maxConsecutiveErrors: 3 });
        }

        if (this.animationLoopStarted) return;

        this.animationLoopStarted = true;
        this.clock.start();
        this.clock.getDelta();
        this.animate();
    }

    updateAmbientSparkFlow(delta) {
        const state = this.ambientSparkState;
        if (!state) return;

        const stageHeat = this.fxState.stageHeat || 0;
        const dangerLevel = this.fxState.dangerLevel || 0;
        const rewardPulse = this.fxState.rewardPulse || 0;
        const overdrivePulse = this.fxState.overdrivePulse || 0;
        const openness = this.getAmbientCenterOpenFactor();
        const flowBias = stageHeat * 0.26
            + this.fxState.comboCharge * 0.28
            + this.fxState.comboPeak * 0.44
            + this.fxState.surgeState * 0.7
            + this.fxState.lineSurge * 0.24
            + this.fxState.lockImpact * 0.18
            + rewardPulse * 0.18
            + overdrivePulse * 0.26;
        const activeCount = Math.min(
            state.count,
            Math.max(12, Math.round(state.count * this.getAmbientDensityMultiplier() * (0.88 + rewardPulse * 0.08 + dangerLevel * 0.06 + overdrivePulse * 0.12))),
        );

        for (let i = 0; i < activeCount; i += 1) {
            state.progress[i] += delta * state.speeds[i] * (
                1
                + flowBias
                + (this.comboSpeedBoost - 1) * 0.45
                + stageHeat * 0.22
            );
            if (state.progress[i] > 1) {
                state.progress[i] -= 1;
                this.reseedAmbientParticle(state, i);
            }

            const mode = state.modes[i];
            const band = state.bandIndices[i];
            const primaryBlob = this.blobs[state.primaryBlobIndices[i]] || null;
            const secondaryBlob = this.blobs[state.secondaryBlobIndices[i]] || null;

            if (mode === AMBIENT_PARTICLE_MODES.surface) {
                this.sampleAmbientSurfacePoint(state, i, primaryBlob, this.tmpVec3A, this.tmpVec3B);
            } else if (mode === AMBIENT_PARTICLE_MODES.bridge) {
                this.sampleAmbientBridgePoint(state, i, primaryBlob, secondaryBlob, this.tmpVec3A, this.tmpVec3B);
            } else if (mode === AMBIENT_PARTICLE_MODES.hero) {
                this.sampleAmbientHeroPoint(state, i, this.tmpVec3A, this.tmpVec3B);
            } else {
                this.sampleAmbientBackgroundPoint(state, i, this.tmpVec3A, this.tmpVec3B);
            }

            const tangentialDrift = 0.06
                + stageHeat * 0.1
                + state.adhesion[i] * 0.08
                + (mode === AMBIENT_PARTICLE_MODES.bridge ? 0.04 : 0)
                + (mode === AMBIENT_PARTICLE_MODES.hero ? 0.08 + rewardPulse * 0.05 : 0);
            this.tmpVec3A.addScaledVector(this.tmpVec3B, tangentialDrift);

            const curlInfluence = this.applyAmbientImpactCurl(this.tmpVec3A, flowBias, openness, band);
            const exclusionInfluence = this.applyAmbientCenterExclusion(this.tmpVec3A, openness, band);
            const influence = Math.max(curlInfluence, exclusionInfluence * 0.7);

            const idx = i * 3;
            state.positions[idx] = this.tmpVec3A.x;
            state.positions[idx + 1] = this.tmpVec3A.y;
            state.positions[idx + 2] = this.tmpVec3A.z;

            this.tmpColorA.copy(primaryBlob?.currentColor || this.fxState.dominantAccent || BLOB_COLORS[0]);
            if (mode === AMBIENT_PARTICLE_MODES.bridge && secondaryBlob?.currentColor) {
                this.tmpColorA.lerp(secondaryBlob.currentColor, 0.45);
            } else if (mode === AMBIENT_PARTICLE_MODES.hero) {
                this.tmpColorA.copy(this.fxState.dominantAccent || BLOB_COLORS[0])
                    .lerp(this.fxState.supportAccent || BLOB_COLORS[1], 0.38 + rewardPulse * 0.12);
            } else if (mode === AMBIENT_PARTICLE_MODES.ambient) {
                this.tmpColorA.lerp(this.fxState.supportAccent || BLOB_COLORS[1], 0.24 + state.depths[i] * 0.12);
            }
            if (dangerLevel > 0.15) {
                this.tmpColorA.lerp(this.tmpColorB.set(0xff7a48), dangerLevel * 0.22);
            }
            const accentMix = THREE.MathUtils.clamp(
                influence * 0.28 + flowBias * 0.08 + state.adhesion[i] * 0.06 + rewardPulse * 0.06,
                0,
                0.34,
            );
            this.tmpColorB.copy(this.fxState.dominantAccent || BLOB_COLORS[0]);
            this.tmpColorA.lerp(this.tmpColorB, accentMix);

            let colorEnergy = 0.48;
            if (mode === AMBIENT_PARTICLE_MODES.surface) {
                colorEnergy = 0.62;
            } else if (mode === AMBIENT_PARTICLE_MODES.bridge) {
                colorEnergy = 0.72;
            } else if (mode === AMBIENT_PARTICLE_MODES.hero) {
                colorEnergy = 0.86 + rewardPulse * 0.08 + overdrivePulse * 0.08;
            }
            state.colors[idx] = THREE.MathUtils.clamp(this.tmpColorA.r * colorEnergy, 0, 1);
            state.colors[idx + 1] = THREE.MathUtils.clamp(this.tmpColorA.g * colorEnergy, 0, 1);
            state.colors[idx + 2] = THREE.MathUtils.clamp(this.tmpColorA.b * colorEnergy, 0, 1);

            if (state.sizes && state.baseSizes) {
                let modeScale = 0.58;
                if (mode === AMBIENT_PARTICLE_MODES.surface) {
                    modeScale = 0.68;
                } else if (mode === AMBIENT_PARTICLE_MODES.bridge) {
                    modeScale = 0.74;
                } else if (mode === AMBIENT_PARTICLE_MODES.hero) {
                    modeScale = 0.86 + rewardPulse * 0.06 + overdrivePulse * 0.08;
                }
                state.sizes[i] = state.baseSizes[i] * (
                    modeScale
                    + flowBias * 0.08
                    + influence * 0.06
                    + dangerLevel * 0.04
                );
            }
        }

        // Upload only the slice we actually animated this frame, not the full buffer.
        // activeCount can be much less than allocated capacity, so this is a 30-50%
        // bandwidth saving on the per-frame ambient particle upload (~13KB → ~6-9KB).
        const writeFloats = activeCount * 3;
        state.positionAttr.updateRange = { offset: 0, count: writeFloats };
        state.colorAttr.updateRange = { offset: 0, count: writeFloats };
        state.positionAttr.needsUpdate = true;
        state.colorAttr.needsUpdate = true;
        if (state.sizeAttr) {
            state.sizeAttr.updateRange = { offset: 0, count: activeCount };
            state.sizeAttr.needsUpdate = true;
        }
        this.applyAmbientDrawRange();
    }

    updateSparks(delta) {
        if (this.sparkUniforms) {
            this.sparkUniforms.uTime.value = this.time;
            this.sparkUniforms.uComboIntensity.value = this.comboIntensity
                + this.fxState.stageHeat * 0.18
                + this.fxState.comboCharge * 0.22
                + this.fxState.comboPeak * 0.35
                + this.fxState.surgeState * 0.4;
            if (this.sparkUniforms.uColorA) {
                this.sparkUniforms.uColorA.value.copy(this.fxState.dominantAccent || BLOB_COLORS[0]);
            }
            if (this.sparkUniforms.uColorB) {
                this.sparkUniforms.uColorB.value.copy(this.fxState.supportAccent || BLOB_COLORS[1]);
            }
        }

        if (this.sparkCompute && this.flags.useCompute) {
            this.sparkCompute.update(delta, this.time, {
                comboIntensity: this.comboIntensity,
                comboSpeedBoost: this.comboSpeedBoost,
                boundsWidth: this.screenBounds.width,
                boundsHeight: this.screenBounds.height,
            });
        } else if (this.sparks && !this.sparkUniforms) {
            // WebGL path
            this.sparks.material.uniforms.uTime.value = this.time;
            this.sparks.material.uniforms.uComboIntensity.value = this.comboIntensity;
            this.sparks.material.uniforms.uComboSpeedBoost.value = this.comboSpeedBoost;
            this.sparks.material.uniforms.uComboSizeBoost.value = 1.0 + this.comboScaleBoost * 1.5;
        }

        if (this.ambientSparkState) {
            this.updateAmbientSparkFlow(delta);
        }

        this.updateGameplaySparkBursts(delta);
        this.updateLineWakes(delta);
        this.updateMicroGlints(delta);
        this.heroParticles?.update(delta, this.time, this.fxState.stageHeat || 0);
    }

    updateBackground() {
        if (this.backgroundUniforms) {
            const dangerLevel = this.fxState.dangerLevel || 0;
            const rewardPulse = this.fxState.rewardPulse || 0;
            const overdrivePulse = this.fxState.overdrivePulse || 0;
            // WebGPU path
            this.backgroundUniforms.uTime.value = this.time;
            this.backgroundUniforms.uPulse.value = this.comboIntensity * 0.28
                + this.fxState.stageHeat * 0.24
                + this.fxState.comboCharge * 0.22
                + this.fxState.comboPeak * 0.34
                + this.fxState.lineSurge * 0.3
                + this.fxState.surgeState * 0.44
                + rewardPulse * 0.18
                + overdrivePulse * 0.22;
            if (this.backgroundUniforms.uHeat) {
                this.backgroundUniforms.uHeat.value = this.fxState.stageHeat;
            }
            if (this.backgroundUniforms.uBeatPulse) {
                this.backgroundUniforms.uBeatPulse.value = this.fxState.beatPulse;
            }
            if (this.backgroundUniforms.uActProgress) {
                this.backgroundUniforms.uActProgress.value = this.fxState.actProgress;
            }
            if (this.backgroundUniforms.uFieldTakeover) {
                this.backgroundUniforms.uFieldTakeover.value = this.fxState.fieldTakeover;
            }
            if (this.backgroundUniforms.uFarPodMix) {
                const farPodsVisible = this.particleOrchestrator?.shouldShowFarPods?.(
                    this.adaptiveBudgetState?.effectsShedLevel ?? 0,
                ) !== false;
                this.backgroundUniforms.uFarPodMix.value = farPodsVisible ? 1 : 0;
            }
            if (this.backgroundUniforms.uAccentA) {
                this.backgroundUniforms.uAccentA.value.copy(this.fxState.dominantAccent)
                    .lerp(this.tmpColorA.set(0xff8f5a), dangerLevel * 0.24);
            }
            if (this.backgroundUniforms.uAccentB) {
                this.backgroundUniforms.uAccentB.value.copy(this.fxState.supportAccent)
                    .lerp(this.tmpColorB.set(0xff4fd8), overdrivePulse * 0.16);
            }
        } else if (this.backgroundMesh) {
            // WebGL path
            this.backgroundMesh.material.uniforms.uTime.value = this.time;
        }
    }

    updateCoreLight() {
        if (!this.coreLight) return;
        const dangerLevel = this.fxState.dangerLevel || 0;
        const rewardPulse = this.fxState.rewardPulse || 0;
        const overdrivePulse = this.fxState.overdrivePulse || 0;
        const lightColor = this.tmpColorA.copy(this.fxState.dominantAccent)
            .lerp(this.fxState.supportAccent, 0.28 + this.fxState.beatPulse * 0.12)
            .lerp(this.tmpColorB.set(0xff8450), dangerLevel * 0.24)
            .offsetHSL((this.fxState.barPhase - 0.5) * 0.02, 0.02, this.fxState.heroWindow * 0.02 + rewardPulse * 0.01);
        const lightness = 0.24
            + this.glowFlash * 0.12
            + this.comboColorFlash * 0.08
            + this.fxState.lineSurge * 0.06
            + this.fxState.surgeState * 0.08
            + this.fxState.stageHeat * 0.04
            + this.fxState.beatPulse * 0.05
            + rewardPulse * 0.05;
        lightColor.multiplyScalar(0.62 + lightness);
        this.coreLight.color.copy(lightColor);
        this.coreLight.intensity = 0.42 + this.pulseIntensity * 0.28
            + this.glowFlash * 0.24
            + this.comboIntensity * 0.16
            + this.fxState.lineSurge * 0.18
            + this.fxState.surgeState * 0.26
            + this.fxState.stageHeat * 0.18
            + this.fxState.beatPulse * 0.08
            + rewardPulse * 0.12
            - dangerLevel * 0.08
            + overdrivePulse * 0.1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Blob Update (shared logic for both paths)
    // ─────────────────────────────────────────────────────────────────────────
    updateBlobs(delta = (1 / 60)) {
        const bounds = this.screenBounds;
        const t = this.time;
        const frameScale = Math.max(0.55, delta * 60);
        const stageHeat = this.fxState.stageHeat || 0;
        const beatPulse = this.fxState.beatPulse || 0;
        const phrasePhase = this.fxState.phrasePhase || 0;
        const heroWindow = this.fxState.heroWindow || 0;
        const comboMotionBoost = this.comboIntensity * 0.22
            + this.fxState.comboPeak * 0.28
            + this.fxState.surgeState * 0.35
            + this.fxState.lineSurge * 0.14;
        const stageInvasion = THREE.MathUtils.clamp(
            stageHeat * 0.58
                + this.fxState.comboPeak * 0.24
                + this.fxState.surgeState * 0.3
                + this.fxState.fieldTakeover * 0.24
                + this.fxState.actProgress * 0.08,
            0,
            1,
        );

        for (let i = 0; i < this.blobs.length; i += 1) {
            const blob = this.blobs[i];
            const profile = blob.motionProfile || BLOB_MOTION_PROFILES.support;
            const driftScale = blob.driftScale || 1;
            const motionTime = t * profile.baseSpeed;
            const targetInvasion = THREE.MathUtils.clamp(
                stageInvasion * ((blob.stageWeight || 0.5) * 1.18) + this.fxState.comboCharge * 0.08 * blob.corridorBias,
                0,
                1,
            );
            const phraseCadence = Math.sin((phrasePhase * Math.PI * 2) + blob.restPhase) * 0.5 + 0.5;
            const stillnessWindow = THREE.MathUtils.smootherstep(phraseCadence, 0.32, 0.98);
            const eventLift = THREE.MathUtils.clamp(
                heroWindow * 0.28 + beatPulse * 0.12 + targetInvasion * 0.42 + comboMotionBoost * 0.35,
                0,
                0.7,
            );
            const targetActivity = THREE.MathUtils.clamp(
                1 - (stillnessWindow * profile.idleWindowStrength) + eventLift,
                blob.tier === 'ghost' ? 0.34 : 0.48,
                1.16,
            );
            blob.motionActivity += (targetActivity - blob.motionActivity) * (0.035 + heroWindow * 0.02);
            const activityScale = blob.motionActivity * blob.motionBias;
            const stillnessDamping = 1 - ((1 - blob.motionActivity) * profile.settleStrength);

            // Only reset proximity on frames where we'll recompute (avoids zero-flicker shaking)
            if (this.frameCount % 3 === 0) {
                blob.proximityBoost = 0;
                blob.nearestDir.set(0, 0, 0);
                blob.clusterWeight = 0;
                blob.mergeAffinity = 0;
                blob.contactBlend = 0;
                blob.clusterScaleBlend = 0;
                blob.clusterCenter.set(0, 0, 0);
                blob.clusterVector.set(0, 0, 0);
                blob.clusterFlowDirection.set(0, 0, 0);
                blob.mergeColor.copy(blob.baseColor);
                blob.mergeColorStrength = 0;
            }

            blob.reaction += (blob.reactionTarget - blob.reaction) * 0.14;
            blob.reactionTarget *= 0.92;
            blob.rimBoost += (blob.rimBoostTarget - blob.rimBoost) * 0.12;
            blob.rimBoostTarget *= 0.9;
            blob.flowStrength += (blob.flowTarget - blob.flowStrength) * 0.12;
            blob.flowTarget *= 0.92;
            blob.eventColorStrength += (blob.eventColorTarget - blob.eventColorStrength) * 0.14;
            blob.eventColorTarget *= 0.9;
            blob.reactionVector.lerp(blob.reactionVectorTarget, 0.18).normalize();
            blob.reactionVectorTarget.lerp(this.tmpVec3D.set(0, 0.15, 1), 0.08).normalize();

            blob.dynamicAnchor.copy(blob.homePosition).lerp(blob.hotPosition, targetInvasion);

            const convection = Math.sin(motionTime * (0.72 + blob.convectionSpeed) + blob.convectionPhase);
            const convectionSecondary = Math.cos(
                motionTime * (0.34 + blob.convectionSpeed * 0.72) + blob.phaseY * 0.9,
            );
            blob.convectionValue = convection;

            const xTarget = (
                Math.sin(motionTime * blob.freqX + blob.phaseX) * blob.ampX
                + Math.sin(motionTime * (blob.freq2X + 0.02) + blob.phaseX * 1.7) * blob.ampX * 0.72
                + Math.cos(motionTime * 0.12 + blob.phaseZ) * 0.46
            ) * profile.xyDriftMult * driftScale * 0.28 * activityScale;
            const yTarget = (
                Math.sin(motionTime * blob.freqY + blob.phaseY) * blob.ampY
                + Math.cos(motionTime * (blob.freq2Y + 0.015) + blob.phaseY * 1.3) * blob.ampY * 0.64
            ) * profile.xyDriftMult * driftScale * 0.24 * activityScale
                + convection * (0.18 + blob.baseScale * 0.055) * profile.xyDriftMult * activityScale
                + convectionSecondary * 0.2 * activityScale;
            const zTarget = (
                Math.sin(motionTime * blob.freqZ + blob.phaseZ) * blob.ampZ
                + Math.cos(motionTime * (blob.freqZ * 0.7 + 0.02) + blob.phaseZ * 2.1) * blob.ampZ * 0.7
            ) * profile.zDriftMult * driftScale * 0.22 * activityScale;

            blob.anchorVelocity.x += (xTarget - blob.anchorOffset.x) * profile.anchorStiffness * frameScale;
            blob.anchorVelocity.y += (yTarget - blob.anchorOffset.y) * profile.anchorStiffness * frameScale;
            blob.anchorVelocity.z += (zTarget - blob.anchorOffset.z) * profile.anchorStiffness * frameScale;
            blob.anchorVelocity.multiplyScalar(profile.positionalDamping ** frameScale);
            blob.anchorVelocity.multiplyScalar(stillnessDamping);
            blob.anchorOffset.add(blob.anchorVelocity);

            const desiredDepth = convection * profile.depthTravel
                + convectionSecondary * profile.depthTravel * 0.24
                + blob.depthBias
                + targetInvasion * profile.depthTravel * 0.4
                + comboMotionBoost * profile.depthTravel * 0.18 * blob.corridorBias * blob.motionActivity;
            blob.depthVelocity += (desiredDepth - blob.depthOffset) * (profile.anchorStiffness * 0.72) * frameScale;
            blob.depthVelocity *= profile.positionalDamping ** frameScale;
            blob.depthVelocity *= stillnessDamping;
            blob.depthOffset += blob.depthVelocity;

            blob.dynamicAnchor.x += blob.anchorOffset.x;
            blob.dynamicAnchor.y += blob.anchorOffset.y;
            blob.dynamicAnchor.z += blob.anchorOffset.z + blob.depthOffset;
            blob.dynamicAnchor.x = THREE.MathUtils.clamp(blob.dynamicAnchor.x, -bounds.width * 1.14, bounds.width * 1.14);
            blob.dynamicAnchor.y = THREE.MathUtils.clamp(blob.dynamicAnchor.y, -bounds.height * 1.18, bounds.height * 1.18);
            blob.dynamicAnchor.z = THREE.MathUtils.clamp(blob.dynamicAnchor.z, profile.backClamp, profile.frontClamp);
        }

        // Run full proximity detection every 3rd frame (visual blending is gradual)
        // Hard contact separation always runs with cheap distSq pre-check
        const doFullProximity = this.frameCount % 3 === 0;

        // Cache each blob's render radius and max interaction range ONCE per frame.
        // Previously getBlobRenderRadius() was called n*(n-1) times in the inner loop —
        // for 16 blobs that's 240 calls. Now it's 16. Also pre-cache mesh.position ref.
        const blobCount = this.blobs.length;
        let maxRadius = 0;
        for (let k = 0; k < blobCount; k += 1) {
            const b = this.blobs[k];
            b._cachedRadius = this.getBlobRenderRadius(b);
            b._cachedPos = b.mainMesh.position;
            if (b._cachedRadius > maxRadius) maxRadius = b._cachedRadius;
        }
        // Max possible interaction distance squared — anything beyond this is guaranteed-skip.
        const maxInteractDistSq = (maxRadius * 2 * 1.65) * (maxRadius * 2 * 1.65);

        for (let i = 0; i < blobCount; i += 1) {
            for (let j = i + 1; j < blobCount; j += 1) {
                const blobA = this.blobs[i];
                const blobB = this.blobs[j];
                const posA = blobA._cachedPos;
                const posB = blobB._cachedPos;

                const dx = posB.x - posA.x;
                const dy = posB.y - posA.y;
                const dz = posB.z - posA.z;
                const distSq = dx * dx + dy * dy + dz * dz;

                // Coarse early-out: if even the max-radius pair couldn't reach,
                // skip all per-pair math (radii lookups, hard-contact math, etc.)
                if (distSq >= maxInteractDistSq) continue;

                const radiusA = blobA._cachedRadius;
                const radiusB = blobB._cachedRadius;
                const combinedRadii = Math.max(0.1, radiusA + radiusB);

                // Always run hard contact separation (cheap distSq check avoids sqrt)
                const hardContactDist = combinedRadii * 0.58;
                if (distSq < hardContactDist * hardContactDist && distSq > 0.0001) {
                    const dist = Math.sqrt(distSq);
                    const profileA = blobA.motionProfile || BLOB_MOTION_PROFILES.support;
                    const profileB = blobB.motionProfile || BLOB_MOTION_PROFILES.support;
                    this.tmpVec3C.set(dx, dy, dz).multiplyScalar(-1 / dist);
                    const separation = THREE.MathUtils.clamp(1 - (dist / hardContactDist), 0, 1);
                    const impulse = separation * separation;
                    blobA.velocity.addScaledVector(this.tmpVec3C, profileA.contactRepel * impulse * frameScale * 0.55);
                    blobB.velocity.addScaledVector(this.tmpVec3C, -profileB.contactRepel * impulse * frameScale * 0.55);
                    blobA.velocity.multiplyScalar(0.992);
                    blobB.velocity.multiplyScalar(0.992);
                }

                // Skip expensive proximity blending on non-proximity frames
                if (!doFullProximity) continue;

                const awarenessDist = combinedRadii * 1.65;
                const awarenessDistSq = awarenessDist * awarenessDist;
                if (distSq >= awarenessDistSq || distSq <= 0.0001) continue;

                const dist = Math.sqrt(distSq);
                this.tmpVec3A.set(dx, dy, dz).multiplyScalar(1 / dist);
                this.tmpVec3B.copy(posA).add(posB).multiplyScalar(0.5);

                const awareness = THREE.MathUtils.clamp(1 - (dist / awarenessDist), 0, 1);
                const awarenessBlend = awareness * awareness * (3 - (2 * awareness));
                blobA.proximityBoost += awarenessBlend * 0.34;
                blobB.proximityBoost += awarenessBlend * 0.34;
                blobA.nearestDir.addScaledVector(this.tmpVec3A, awarenessBlend * 0.42);
                blobB.nearestDir.addScaledVector(this.tmpVec3A, -awarenessBlend * 0.42);

                const approachDist = combinedRadii * 1.08;
                if (dist < approachDist) {
                    const approach = THREE.MathUtils.clamp(1 - (dist / approachDist), 0, 1);
                    const approachBlend = approach * approach * (3 - (2 * approach));
                    blobA.clusterWeight += approachBlend;
                    blobB.clusterWeight += approachBlend;
                    blobA.clusterCenter.addScaledVector(this.tmpVec3B, approachBlend);
                    blobB.clusterCenter.addScaledVector(this.tmpVec3B, approachBlend);
                }

                const sharedFlowDist = combinedRadii * 0.92;
                if (dist < sharedFlowDist) {
                    const sharedFlow = THREE.MathUtils.clamp(1 - (dist / sharedFlowDist), 0, 1);
                    blobA.mergeAffinity = Math.max(blobA.mergeAffinity, sharedFlow);
                    blobB.mergeAffinity = Math.max(blobB.mergeAffinity, sharedFlow);
                    blobA.mergeColor.lerp(blobB.baseColor, sharedFlow * 0.12);
                    blobB.mergeColor.lerp(blobA.baseColor, sharedFlow * 0.12);
                    blobA.mergeColorStrength = Math.max(blobA.mergeColorStrength, sharedFlow * 0.3);
                    blobB.mergeColorStrength = Math.max(blobB.mergeColorStrength, sharedFlow * 0.3);
                    blobA.clusterFlowDirection.addScaledVector(this.tmpVec3A, sharedFlow * 0.8);
                    blobB.clusterFlowDirection.addScaledVector(this.tmpVec3A, -sharedFlow * 0.8);
                }

                const contactDist = combinedRadii * 0.68;
                if (dist < contactDist) {
                    const contact = THREE.MathUtils.clamp(1 - (dist / contactDist), 0, 1);
                    blobA.contactBlend = Math.max(blobA.contactBlend, contact);
                    blobB.contactBlend = Math.max(blobB.contactBlend, contact);

                    this.tmpVec3C.copy(posA).sub(this.tmpVec3B);
                    if (this.tmpVec3C.lengthSq() <= 0.0001) {
                        this.tmpVec3C.copy(this.tmpVec3A).multiplyScalar(-1);
                    }
                    this.tmpVec3C.normalize();
                    blobA.clusterVector.addScaledVector(this.tmpVec3C, contact);
                    blobB.clusterVector.addScaledVector(this.tmpVec3C, -contact);
                }
            }
        }

        for (let i = 0; i < this.blobs.length; i += 1) {
            const blob = this.blobs[i];
            const pos = blob.mainMesh.position;
            const profile = blob.motionProfile || BLOB_MOTION_PROFILES.support;
            const targetInvasion = THREE.MathUtils.clamp(
                stageInvasion * ((blob.stageWeight || 0.5) * 1.18) + this.fxState.comboCharge * 0.08 * blob.corridorBias,
                0,
                1,
            );
            const stillnessDamping = 1 - ((1 - blob.motionActivity) * profile.settleStrength);

            if (blob.clusterWeight > 0.0001) {
                blob.clusterCenter.multiplyScalar(1 / blob.clusterWeight);
            } else {
                blob.clusterCenter.copy(blob.dynamicAnchor);
            }

            if (blob.nearestDir.lengthSq() > 0.0001) {
                blob.nearestDir.normalize();
            }
            if (blob.clusterVector.lengthSq() > 0.0001) {
                blob.clusterVector.normalize();
            }
            if (blob.clusterFlowDirection.lengthSq() > 0.0001) {
                blob.clusterFlowDirection.normalize();
            } else {
                blob.clusterFlowDirection.copy(blob.reactionVector);
            }

            const clusterInfluence = THREE.MathUtils.clamp(
                blob.clusterWeight * 0.36 + blob.mergeAffinity * 0.42,
                0,
                1,
            );

            this.tmpVec3E.copy(blob.dynamicAnchor).sub(pos);
            blob.velocity.addScaledVector(this.tmpVec3E, profile.anchorStiffness * frameScale);

            if (clusterInfluence > 0.001) {
                this.tmpVec3F.copy(blob.clusterCenter).sub(pos);
                blob.velocity.addScaledVector(this.tmpVec3F, profile.approachPull * clusterInfluence * frameScale);
                if (blob.nearestDir.lengthSq() > 0.0001) {
                    blob.velocity.addScaledVector(
                        blob.nearestDir,
                        profile.approachPull * 0.18 * clusterInfluence * frameScale,
                    );
                }
                blob.anchorVelocity.multiplyScalar(1 - Math.min(clusterInfluence * 0.08, 0.16));
            }

            if (blob.contactBlend > 0.001 && blob.clusterVector.lengthSq() > 0.0001) {
                const contactPush = blob.contactBlend * blob.contactBlend;
                blob.velocity.addScaledVector(blob.clusterVector, profile.contactRepel * contactPush * frameScale * 0.5);
                blob.velocity.multiplyScalar(1 - Math.min(contactPush * 0.025, 0.04));
                blob.anchorVelocity.multiplyScalar(1 - Math.min(contactPush * 0.02, 0.035));
            }

            if (blob.reaction > 0.01) {
                blob.velocity.addScaledVector(blob.reactionVector, blob.reaction * 0.018 * frameScale);
            }

            blob.velocity.multiplyScalar(profile.positionalDamping ** frameScale);
            blob.velocity.multiplyScalar(stillnessDamping);
            pos.add(blob.velocity);

            const maxX = bounds.width * (blob.tier === 'hero' ? 1.02 : 1.1);
            const maxY = bounds.height * (blob.tier === 'hero' ? 0.98 : 1.08);
            if (Math.abs(pos.x) > maxX) {
                pos.x = THREE.MathUtils.lerp(pos.x, Math.sign(pos.x) * maxX, 0.12);
                blob.velocity.x *= 0.74;
            }
            if (Math.abs(pos.y) > maxY) {
                pos.y = THREE.MathUtils.lerp(pos.y, Math.sign(pos.y) * maxY, 0.12);
                blob.velocity.y *= 0.74;
            }
            if (pos.z > profile.frontClamp) {
                pos.z = THREE.MathUtils.lerp(pos.z, profile.frontClamp, 0.16);
                blob.velocity.z *= 0.72;
            } else if (pos.z < profile.backClamp) {
                pos.z = THREE.MathUtils.lerp(pos.z, profile.backClamp, 0.16);
                blob.velocity.z *= 0.72;
            }

            const convectionT = THREE.MathUtils.clamp(blob.convectionValue * 0.5 + 0.5, 0, 1);
            const verticalMotion = THREE.MathUtils.clamp((blob.velocity.y * 0.12) + blob.convectionValue * 0.4, -1, 1);
            const convectionScale = THREE.MathUtils.lerp(
                profile.breathMin,
                profile.breathMax,
                convectionT ** 1.1,
            );
            const sharedScalePhase = Math.sin(
                t * (0.22 + profile.baseSpeed * 0.08)
                    + blob.clusterCenter.x * 0.06
                    + blob.clusterCenter.y * 0.05
                    + blob.convectionPhase,
            );
            blob.clusterScaleBlend = Math.min(
                profile.scaleShare,
                clusterInfluence * (0.25 + blob.mergeAffinity * 0.2),
            );
            const sharedScale = 1 + sharedScalePhase * blob.clusterScaleBlend * 0.1;
            const mergeScale = 1 + blob.mergeAffinity * 0.08 + blob.clusterWeight * 0.035;
            const eventScale = 1
                + this.comboScaleBoost * 0.18
                + this.fxState.comboPeak * 0.08
                + this.fxState.surgeState * 0.09
                + blob.reaction * 0.05
                + stageHeat * 0.04 * blob.corridorBias;
            const tierPresenceScale = 1 + targetInvasion * profile.presenceScale;
            const targetScaleFactor = THREE.MathUtils.clamp(
                THREE.MathUtils.lerp(1, convectionScale, 0.72 * blob.motionActivity)
                    * sharedScale * mergeScale * eventScale * tierPresenceScale,
                profile.finalMin,
                profile.finalMax,
            );
            blob.targetScale = blob.baseScale * targetScaleFactor;
            blob.scaleVelocity += (blob.targetScale - blob.scale) * (0.022 + clusterInfluence * 0.008) * frameScale;
            blob.scaleVelocity *= profile.scaleDamping ** frameScale;
            blob.scale += blob.scaleVelocity;
            blob.scale = THREE.MathUtils.clamp(
                blob.scale,
                blob.baseScale * profile.finalMin,
                blob.baseScale * profile.finalMax,
            );

            const expansion = THREE.MathUtils.clamp(
                blob.scaleVelocity / Math.max(blob.baseScale * 0.06, 0.0001),
                -1,
                1,
            );
            const softMorph = Math.max(0, verticalMotion * 0.45 + expansion * 0.55);
            const denseMorph = Math.max(0, (-verticalMotion) * 0.35 + (-expansion) * 0.45);
            const baseMorph = blob.morphBase * (0.72 + softMorph * 0.62 + denseMorph * 0.18);
            const proximityMorph = Math.min(blob.proximityBoost * 0.7 + blob.mergeAffinity * 0.24, 0.95);
            const comboMorph = this.comboIntensity * 0.22 + this.fxState.comboPeak * 0.2 + this.fxState.surgeState * 0.1;
            const flowMorph = blob.flowStrength * 0.54 + this.fxState.lineSurge * 0.14 + blob.mergeAffinity * 0.22;
            const morphIntensity = Math.min(
                profile.morphCeiling,
                (baseMorph + proximityMorph + comboMorph + flowMorph) * (0.82 + blob.motionActivity * 0.16),
            );

            const totalGlow = Math.min(
                this.pulseIntensity * 0.12
                + blob.proximityBoost * 0.08
                + this.glowFlash * 0.1
                + this.comboColorFlash * 0.07
                + this.comboIntensity * 0.05
                + blob.rimBoost * 0.22
                + blob.mergeAffinity * 0.08
                + clusterInfluence * 0.1
                + blob.contactBlend * 0.06
                + this.fxState.lineSurge * 0.08
                + this.fxState.surgeState * 0.1
                + stageHeat * 0.08 * blob.corridorBias,
                0.72,
            );

            const hueShift = Math.sin((t * 0.14) + blob.phaseX) * 0.01 * (0.55 + blob.proximityBoost * 0.22);
            const saturationBoost = Math.min(
                0.18,
                0.06 + blob.proximityBoost * 0.03 + blob.mergeAffinity * 0.05 + this.comboColorFlash * 0.03 + stageHeat * 0.04,
            );
            const lightnessBoost = Math.min(
                0.016,
                this.comboIntensity * 0.006 + stageHeat * 0.004 + blob.mergeAffinity * 0.003,
            );
            blob.currentColor.copy(blob.baseColor);
            blob.currentColor.offsetHSL(hueShift, saturationBoost, lightnessBoost);
            if (blob.mergeColorStrength > 0.01) {
                blob.currentColor.lerp(blob.mergeColor, Math.min(blob.mergeColorStrength * 0.24, 0.22));
            }
            if (blob.eventColorStrength > 0.01) {
                blob.currentColor.lerp(blob.eventColor, Math.min(blob.eventColorStrength * 0.26, 0.34));
            }
            blob.currentColor.multiplyScalar(0.88 + stageHeat * 0.05 - blob.contactBlend * 0.025);

            const directionalAxis = this.tmpVec3A;
            if (blob.contactBlend > 0.02 && blob.clusterVector.lengthSq() > 0.0001) {
                directionalAxis.copy(blob.clusterVector);
            } else if (blob.reactionVector.lengthSq() > 0.0001) {
                directionalAxis.copy(blob.reactionVector);
            } else if (blob.clusterFlowDirection.lengthSq() > 0.0001) {
                directionalAxis.copy(blob.clusterFlowDirection);
            } else if (blob.velocity.lengthSq() > 0.0001) {
                directionalAxis.copy(blob.velocity);
            } else {
                directionalAxis.set(0, 0.15, 1);
            }
            directionalAxis.normalize();

            const reactionStretch = 1
                + blob.reaction * 0.1
                + this.fxState.surgeState * 0.025
                + blob.contactBlend * 0.08
                + clusterInfluence * 0.04;
            const reactionSquash = Math.max(0.88, 1 - blob.reaction * 0.035 - blob.contactBlend * 0.05);
            const rotBoost = 1.0 + this.comboIntensity * 0.22 + this.fxState.comboPeak * 0.18 + clusterInfluence * 0.08;
            blob.rotationVelocity.x += (
                (blob.rotSpeedX * profile.rotationBase) + blob.velocity.y * profile.rotationResponse - blob.rotationVelocity.x
            ) * 0.08 * frameScale;
            blob.rotationVelocity.y += (
                (blob.rotSpeedY * profile.rotationBase) + blob.velocity.x * (profile.rotationResponse * 1.12) - blob.rotationVelocity.y
            ) * 0.08 * frameScale;
            blob.rotationVelocity.z += (
                (blob.rotSpeedZ * profile.rotationBase) + blob.velocity.z * (profile.rotationResponse * 0.68) - blob.rotationVelocity.z
            ) * 0.08 * frameScale;
            blob.rotationVelocity.multiplyScalar(0.94 ** frameScale);
            for (let j = 0; j < blob.meshes.length; j += 1) {
                const mesh = blob.meshes[j];
                mesh.position.copy(pos);
                const baseScaleMultiplier = mesh.userData?.baseScaleMultiplier ?? 1;
                const baseScale = blob.scale * baseScaleMultiplier;
                mesh.scale.set(
                    baseScale * (reactionSquash + Math.abs(directionalAxis.x) * (reactionStretch - reactionSquash)),
                    baseScale * (reactionSquash + Math.abs(directionalAxis.y) * (reactionStretch - reactionSquash)),
                    baseScale * (reactionSquash + Math.abs(directionalAxis.z) * (reactionStretch - reactionSquash)),
                );
                mesh.rotation.x += blob.rotationVelocity.x * rotBoost;
                mesh.rotation.y += blob.rotationVelocity.y * rotBoost;
                mesh.rotation.z += blob.rotationVelocity.z * rotBoost;
            }

            if (this.isWebGPU) {
                if (blob.mainUniforms) {
                    blob.mainUniforms.uTime.value = t + blob.phaseX;
                    blob.mainUniforms.uColor.value.copy(blob.currentColor);
                    blob.mainUniforms.uPulseIntensity.value = totalGlow;
                    blob.mainUniforms.uMorphFactor.value = morphIntensity
                        + (this.pulseIntensity * 0.025)
                        + (this.glowFlash * 0.045)
                        + (stageHeat * 0.045)
                        + (blob.mergeAffinity * 0.1);
                    if (blob.mainUniforms.uFlowDirection) {
                        blob.mainUniforms.uFlowDirection.value.copy(directionalAxis);
                    }
                    if (blob.mainUniforms.uFlowStrength) {
                        blob.mainUniforms.uFlowStrength.value = blob.flowStrength
                            + this.fxState.lineSurge * 0.08
                            + stageHeat * 0.06
                            + blob.mergeAffinity * 0.18
                            + clusterInfluence * 0.1;
                    }
                }
                if (blob.interiorUniforms) {
                    blob.interiorUniforms.uTime.value = t + blob.phaseX;
                    blob.interiorUniforms.uColor.value.copy(blob.currentColor).multiplyScalar(0.97 - blob.contactBlend * 0.04);
                    if (blob.interiorUniforms.uFlowDirection) {
                        blob.interiorUniforms.uFlowDirection.value.copy(directionalAxis);
                    }
                    if (blob.interiorUniforms.uFlowStrength) {
                        blob.interiorUniforms.uFlowStrength.value = blob.flowStrength
                            + this.fxState.comboPeak * 0.06
                            + stageHeat * 0.08
                            + blob.mergeAffinity * 0.24
                            + blob.contactBlend * 0.12;
                    }
                }
                if (blob.glowUniforms) {
                    blob.glowUniforms.uTime.value = t + blob.phaseX;
                    blob.glowUniforms.uColor.value.copy(blob.currentColor);
                    blob.glowUniforms.uGlowIntensity.value = 0.06
                        + totalGlow * 0.12
                        + blob.rimBoost * 0.12
                        + stageHeat * 0.04
                        + clusterInfluence * 0.07
                        + blob.contactBlend * 0.04;
                }
            } else {
                const mat = blob.mainMesh.material;
                mat.uniforms.uTime.value = t + blob.phaseX;
                mat.uniforms.uColor.value.copy(blob.currentColor);
                mat.uniforms.uPulseIntensity.value = totalGlow;
                mat.uniforms.uMorphFactor.value = morphIntensity
                    + (this.pulseIntensity * 0.06)
                    + (this.glowFlash * 0.08)
                    + (blob.mergeAffinity * 0.08);
            }
        }
    }

    pause() {
        const paused = super.pause();
        if (!paused) return false;

        this.animationLoopStarted = false;
        this.clock.stop();
        return true;
    }

    resume() {
        const resumed = super.resume();
        if (!resumed) return false;

        this.clock.start();
        this.clock.getDelta();

        if (this._wasPaused) {
            this._wasPaused = false;
            this.animationLoopStarted = false;
            this.startAnimation();
        }

        this.registerDebugHelpers();
        this.scheduleDeferredEffects(40);
        this.scheduleBurstPoolPrewarm(180);

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────────
    resize(w, h) {
        if (!this.renderer || !this.camera) return;

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.screenBounds = this.calculateScreenBounds();
        this.updateBoardHaloLayout();
        this.applyAdaptiveBudgetState(true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stop / Cleanup
    // ─────────────────────────────────────────────────────────────────────────
    stop() {
        this.animationLoopStarted = false;
        this.pendingBurstRequest = null;
        this.clock.stop();
        super.stop();
        this.eventUnsubscribers.forEach((unsub) => {
            if (typeof unsub === 'function') unsub();
        });
        this.eventUnsubscribers = [];

        if (this.boundResizeHandler) {
            window.removeEventListener('resize', this.boundResizeHandler);
            this.boundResizeHandler = null;
        }
        this.boundVisibilityHandler = null;
        this.unregisterDebugHelpers();
    }

    cleanup() {
        this.stop();

        this.burstBlobs.forEach((burstBlob) => this.destroyBurstBlobResources(burstBlob));
        this.burstBlobs = [];
        this.gameplaySparkBursts.forEach((burst) => this.destroyGameplaySparkBurstResources(burst));
        this.gameplaySparkBursts = [];

        const sharedWakeGeometry = this.lineWakes[0]?.mesh?.geometry || null;
        this.lineWakes.forEach((wake) => {
            wake.material?.dispose?.();
            this.scene?.remove?.(wake.mesh);
        });
        this.lineWakes = [];
        sharedWakeGeometry?.dispose?.();

        // Dispose blobs (all layers)
        for (const blob of this.blobs) {
            for (const mesh of blob.meshes) {
                mesh.material.dispose();
                this.scene.remove(mesh);
            }
        }
        this.blobs = [];

        this.disposeSparkSystem();
        this.destroyBoardHalo();
        this.destroyMicroGlints();
        this.destroyHeroParticles();

        // Dispose background
        if (this.backgroundMesh) {
            this.backgroundMesh.geometry.dispose();
            this.backgroundMesh.material.dispose();
            this.scene.remove(this.backgroundMesh);
        }

        // Dispose glass overlay
        if (this.glassMesh) {
            this.glassMesh.geometry.dispose();
            this.glassMesh.material.dispose();
            this.scene.remove(this.glassMesh);
        }

        this.disposePostProcessingStack();

        // Dispose renderer & composer
        if (this.renderer) this.disposeRenderer(this.renderer, { nullInstance: false });

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;
        this.webgpuMaterials = null;
        this.sparkUniforms = null;
        this.backgroundUniforms = null;
        this.boardHaloUniforms = null;
        this.glassUniforms = null;
        this.coreLight = null;
        this.boundResizeHandler = null;
        this.postProfile = null;
        this.adaptiveBudgetState = null;
        this.performanceTelemetry = null;
        this.pendingBurstRequest = null;
        this.fxState = createFxState();
        this.ambientSparkState = null;
        this.boardHaloState = null;
        this.microGlintState = null;
        this.heroParticles = null;
        this.animationLoopStarted = false;
        this.unregisterDebugHelpers();
        this.stageConductor?.reset?.();
        this.boardHaloController?.reset?.();

        this.geometryCache.forEach((geometry) => geometry.dispose());
        this.geometryCache.clear();

        super.cleanup();
    }
}
