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

import * as THREE from 'three/webgpu';
import { TimestampQuery } from 'three/webgpu';
import { mrt, vec3 } from 'three/tsl';

import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BLACK_HOLE_TETROMINOS } from './black-hole-tetrominos.js';
import { BlackHolePost } from './black-hole-post.js';
import { BlackHoleParticleCompute, BlackHoleBurstCompute, BlackHoleLensingCompute } from './black-hole-compute.js';
import BlackHoleFXController, {
    BLACK_HOLE_FX_COMMAND,
} from './black-hole-fx-controller.js';
import {
    createBlackHoleCoreNodeMaterial,
    createAccretionDiskNodeMaterial,
    createStarfieldNodeMaterial,
    createParticleNodeMaterial,
    createBurstSparkNodeMaterial,
    createNebulaCloudNodeMaterial,
    createEventHorizonNodeMaterial,
    createHawkingRadiationNodeMaterial,
    createPhotonSphereNodeMaterial,
    createLensedDiskArcNodeMaterial,
    createLockRippleNodeMaterial,
    createMatterStreamNodeMaterial,
    createPolarJetNodeMaterial,
} from './black-hole-materials.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: {
        starCount: 3200,
        particleCount: 6500,
        comboParticleBudget: 7200,
        nebulaCount: 14,
        diskSegments: 96,
        // Combo bursts are GPU-compute + idle-gated (zero cost between combos) and each spark is a
        // small fixed-pixel additive point, so the buffer can be an order of magnitude larger than the
        // old 600 — closer to the cosmic-noir spark model — for a real firehose during combo chains.
        burstSparkCount: 8000,
        // 1.15x supersampling: still above native so the image stays crisp, while bounding
        // the whole pixel-bound pipeline (the ~50% post baseline + disk fill + all overdraw) by ~30%
        // on high-DPR displays. This is the single biggest uniform FPS lever at Extreme.
        maxPixelRatio: 1.15,
        bloomStrength: 0.3,
        bloomRadius: 0.52,
        bloomDownsample: 0.58,
        bloomMinDownsample: 0.42,
        enablePostProcessing: true,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 3,
        burstCapacityMultiplier: 1,
        burstLifetimeSeconds: 16,
        comboScatterBaseSeconds: 12,
        comboScatterComboSeconds: 0.35,
        comboScatterMaxBonusSeconds: 4,
        burstDecay: 0.96,
        burstMinBatchFactor: 0.05,
        burstMaxBatchFactor: 0.28,
        particleComputeInterval: 0,
        hawkingUpdateInterval: 1 / 45,
        layeredDiskCount: 0,
        sortObjects: true,
    },
    Ultra: {
        starCount: 2400,
        particleCount: 4200,
        comboParticleBudget: 5200,
        nebulaCount: 8,
        diskSegments: 80,
        burstSparkCount: 5000,
        maxPixelRatio: 1.1,
        bloomStrength: 0.27,
        bloomRadius: 0.48,
        bloomDownsample: 0.52,
        bloomMinDownsample: 0.4,
        enablePostProcessing: true,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 2,
        burstCapacityMultiplier: 1,
        burstLifetimeSeconds: 14,
        comboScatterBaseSeconds: 10,
        comboScatterComboSeconds: 0.3,
        comboScatterMaxBonusSeconds: 3.5,
        burstDecay: 0.945,
        burstMinBatchFactor: 0.05,
        burstMaxBatchFactor: 0.26,
        particleComputeInterval: 1 / 90,
        hawkingUpdateInterval: 1 / 36,
        layeredDiskCount: 0,
        sortObjects: true,
    },
    High: {
        starCount: 1500,
        particleCount: 2000,
        comboParticleBudget: 3600,
        // High is the production baseline: the analytic disk and lensed arc own
        // the silhouette, avoiding translucent nebula fill and duplicate disk
        // layers while retaining native-resolution detail.
        nebulaCount: 0,
        diskSegments: 64,
        burstSparkCount: 2600,
        maxPixelRatio: 1.0,
        bloomStrength: 0.22,
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
        burstMinBatchFactor: 0.045,
        burstMaxBatchFactor: 0.24,
        particleComputeInterval: 1 / 30,
        hawkingUpdateInterval: 1 / 24,
        layeredDiskCount: 0,
        sortObjects: false,
    },
    Medium: {
        starCount: 1000,
        particleCount: 1300,
        comboParticleBudget: 2400,
        nebulaCount: 0,
        diskSegments: 48,
        burstSparkCount: 1500,
        maxPixelRatio: 0.95,
        bloomStrength: 0.19,
        bloomRadius: 0.4,
        bloomDownsample: 0.38,
        bloomMinDownsample: 0.3,
        enablePostProcessing: true,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 2,
        burstCapacityMultiplier: 1,
        burstLifetimeSeconds: 8,
        comboScatterBaseSeconds: 5.2,
        comboScatterComboSeconds: 0.17,
        comboScatterMaxBonusSeconds: 1.7,
        burstDecay: 0.91,
        burstMinBatchFactor: 0.04,
        burstMaxBatchFactor: 0.22,
        particleComputeInterval: 1 / 36,
        hawkingUpdateInterval: 1 / 24,
        layeredDiskCount: 0,
        sortObjects: false,
    },
    Low: {
        starCount: 560,
        particleCount: 700,
        comboParticleBudget: 1500,
        nebulaCount: 0,
        diskSegments: 24,
        burstSparkCount: 900,
        maxPixelRatio: 0.85,
        bloomStrength: 0.16,
        bloomRadius: 0.36,
        bloomDownsample: 0.32,
        bloomMinDownsample: 0.26,
        enablePostProcessing: true,
        enableVolumetricDisk: false,
        enableChromatic: false,
        materialNoiseOctaves: 1,
        burstCapacityMultiplier: 1,
        burstLifetimeSeconds: 8,
        comboScatterBaseSeconds: 5,
        comboScatterComboSeconds: 0.16,
        comboScatterMaxBonusSeconds: 1.6,
        burstDecay: 0.9,
        burstMinBatchFactor: 0.04,
        burstMaxBatchFactor: 0.2,
        particleComputeInterval: 1 / 30,
        hawkingUpdateInterval: 1 / 20,
        layeredDiskCount: 0,
        sortObjects: false,
    },
    Minimal: {
        starCount: 300,
        particleCount: 380,
        comboParticleBudget: 1400,
        nebulaCount: 0,
        diskSegments: 18,
        burstSparkCount: 500,
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
        burstMinBatchFactor: 0.035,
        burstMaxBatchFactor: 0.18,
        particleComputeInterval: 1 / 24,
        hawkingUpdateInterval: 1 / 18,
        layeredDiskCount: 0,
        sortObjects: false,
    },
};

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
        // Escape hatch: keep dynamic resolution on the presentation-delta signal even
        // when timestamp queries are available, in case GPU-timed DRS misbehaves on
        // a given driver. Also disables timestamp tracking entirely.
        noGpuDrs: params.has('blackHoleNoGpuDrs') || params.has('blackHoleNoGpuDRS'),
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
            // GPU-work budget for the timestamp-driven path. Measured render time is
            // strictly less than presentation time (it excludes vsync wait / present /
            // CPU), so it is compared against a tighter target — the Definition-of-Success
            // GPU p95 goal — rather than the full frame budget.
            gpuTargetMs: 13.0,
            emaMs: 16.6,
            adjustInterval: 0.5,
            elapsed: 0,
            warmupRemaining: 2.5,
            cooldownRemaining: 0,
            // Actual GPU render cost, fed from resolveTimestampsAsync('render'). DRS
            // consumes drs.gpu.ms when fresh; otherwise it falls back to frame delta.
            usingGpu: false,
            gpu: { ms: 0, valid: false, lastSampleAt: -Infinity },
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
        this.lensedDiskArc = null;
        this.lockRipple = null;
        this.matterStream = null;
        this.polarJet = null;
        this.jetParticles = null;
        this.hawkingAttributes = null;
        this.hawkingVelocities = null;
        this.hawkingLifetimes = null;
        this.hawkingAges = null;
        this.hawkingLifeSpans = null;
        this.hawkingSwirl = null;
        this.hawkingBaseSizes = null;
        this.burstSparksPool = []; // Shipping analytic combo-wave pool on both backends
        // Three short analytic waves cover rapid combo chains without the old
        // full-bank compute dispatch + thousands of additive MRT fragments.
        this.burstPoolSize = 3;
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
        this.diskCosTilt = Math.cos(Math.PI * 0.42);
        this.diskSinTilt = Math.sin(Math.PI * 0.42);

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
        this.chromaticPulse = 0;
        this.particleEventBoost = 0;
        this.gravitySurgeFactor = 0; // State for suction effect
        this.burstFactor = 0; // State for outward explosion effect
        this.burstPhase = false; // Track if we're in burst phase
        this.hawkingIntensity = 1.0;
        this.hawkingTargetIntensity = 1.0;
        this.photonSpherePulse = 0;
        this.comboVisualEnergy = 0;
        this.comboPhenomenon = null;
        this.comboDirectives = null;
        this.uniformCache = {};
        this.gpuTimings = {
            enabled: false,
            lastResolve: 0,
            compute: {},
            renderPending: false,
            nextRenderSampleAt: 0,
        };

        // Animation
        this.clock = new THREE.Clock();
        this.time = 0;

        // Black hole drift (floating motion)
        this.blackHoleGroup = null;
        this.driftX = 0;
        this.driftY = 0;
        // Reusable scratch for the per-frame drift result to avoid allocating an object every frame.
        this._driftScratch = { x: 0, y: 0, z: 0 };
        this.driftPhaseX = this.random() * Math.PI * 2;
        this.driftPhaseY = this.random() * Math.PI * 2;

        // Camera motion state
        this.cameraBasePosition = new THREE.Vector3(0, 105, 1040);
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

        // Orbital-float state: the camera drifts AROUND the black hole rather than hovering
        // at a fixed point. Radius + elevation are seeded from the old fixed base (0,105,1040)
        // so the composition keeps that dramatic near-edge-on angle.
        this.cameraOrbitRadius = Math.hypot(105, 1040);
        this.cameraAzimuthBase = 0;
        this.cameraElevationBase = Math.asin(105 / this.cameraOrbitRadius);
        this.cameraPhaseA = this.random() * Math.PI * 2;
        this.cameraPhaseB = this.random() * Math.PI * 2;
        this.cameraPhaseC = this.random() * Math.PI * 2;
        this.cameraPhaseD = this.random() * Math.PI * 2;
        // Pre-allocated view-basis scratch so the off-centre framing can be applied in
        // CAMERA space (keeps the shadow off-centre on screen even when the orbit carries
        // the camera behind the hole). Reused every frame — never allocate in the loop.
        this._camFwd = new THREE.Vector3();
        this._camRight = new THREE.Vector3();
        this._camUp = new THREE.Vector3();
        this._worldUp = new THREE.Vector3(0, 1, 0);

        // Pointer tracking for parallax camera
        this.pointerX = 0;
        this.pointerY = 0;
        this.smoothedPointerX = 0;
        this.smoothedPointerY = 0;

        // State
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;
        this.resizeHandler = null;
        this.fxController = new BlackHoleFXController({
            reducedMotion: typeof window !== 'undefined'
                && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
        });
        this.fxSignals = this.fxController.getSignals();
        this.fxOrigin = new THREE.Vector3();
        this.fxStreamVector = new THREE.Vector2();
        this.projectedLensCenter = new THREE.Vector3();

        // Persistent scratch for the per-frame post update. Reused every frame so the render
        // loop allocates no garbage (the array + params object were previously new each frame,
        // a steady GC-churn source that shows up as frametime spikes). The constant grade knobs
        // are set once here; only the four dynamic fields are rewritten in the loop, and
        // BlackHolePost.update() dedupes unchanged uniforms so this is behaviourally identical.
        this._lensCenterScratch = [0.5, 0.5];
        this._postUpdateParams = {
            bloomStrength: 0,
            bloomRadius: 0,
            chromaticStrength: 0,
            bloomDownsample: 0,
            lensCenter: this._lensCenterScratch,
            lensStrength: 0.016,
            exposure: 0.96,
            saturation: 1.04,
            tintStrength: 0.12,
            ditherStrength: 0.0012,
        };

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

        // Enable timestamp tracking whenever the backend supports it (not just for the
        // debug flag) so dynamic resolution can steer on measured GPU render time rather
        // than presentation delta. Verbose per-node logging stays behind the debug flags.
        // The escape hatch (?blackHoleNoGpuDrs) forces the presentation-delta path.
        if (supportsTimestampQuery && this.renderer?.backend && !this.flags.noGpuDrs) {
            this.renderer.backend.trackTimestamp = true;
            this.gpuTimings.enabled = true;
            if (this.flags.baseline || this.flags.gpuTimings) {
                console.log('[BlackHole] GPU timestamp queries enabled');
            }
        }

        if (this.flags.baseline) {
            console.log('[BlackHole] WebGPU capability probe', this.capabilities);
        }
    }

    updateCapabilityFlags() {
        const usePost = this.qualityPreset.enablePostProcessing && !this.flags.noPost;
        const supportsMRT = this.isWebGPU && this.capabilities?.maxColorAttachments > 1;
        const useMRT = usePost && !this.flags.noMRT && supportsMRT;
        const useCompute = this.isWebGPU && !this.flags.noCompute;
        // Keep starfield temporally stable: lensing updates can introduce micro shimmer on tiny points.
        const useLensing = false;
        const useUnifiedParticles = useCompute && !this.flags.noUnified;

        this.flags.usePost = usePost;
        this.flags.useMRT = useMRT;
        this.flags.useCompute = useCompute;
        this.flags.useLensing = useLensing;
        this.flags.usePostLensing = usePost
            && !['Low', 'Minimal'].includes(this.getCurrentQualityLevel());
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

    async createScene(ownerGeneration = this.lifecycleGeneration) {
        console.log('[BlackHole] Creating 3D scene...');

        const quality = this.getCurrentQualityLevel();
        this.applyQualityPreset(quality);
        const configuredFps = Number(window.settings?.targetFrameRate) || 60;
        const monitorFps = Number(window.serenityBlocks?.frameRateController?.monitorRefreshRate)
            || configuredFps;
        const adaptiveFps = Math.max(30, Math.min(configuredFps, monitorFps));
        if (this.dynamicResolution) {
            this.dynamicResolution.enabled = !this.flags.noDrs;
            this.dynamicResolution.scale = 1.0;
            this.dynamicResolution.minScale = this.qualityPreset.minRenderScale ?? 0.5;
            this.dynamicResolution.maxScale = 1.0;
            this.dynamicResolution.targetMs = 1000 / adaptiveFps;
            this.dynamicResolution.gpuTargetMs = Math.max(6, (1000 / adaptiveFps) * 0.8);
            this.dynamicResolution.emaMs = this.dynamicResolution.targetMs;
            this.dynamicResolution.elapsed = 0;
            this.dynamicResolution.warmupRemaining = 2.5;
            this.dynamicResolution.cooldownRemaining = 0;
            this.dynamicResolution.usingGpu = false;
            this.dynamicResolution.gpu = { ms: 0, valid: false, lastSampleAt: -Infinity };
        }
        this.fxController.reset();
        this.fxController.configure({
            reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true,
            intensityMultiplier: window.settings?.backgroundComboEffects === false ? 0 : 1,
        });
        this.fxSignals = this.fxController.getSignals();
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

        const rendererReady = await this.initRenderer(container, ownerGeneration);
        if (!rendererReady) return;
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
        this.createRelativisticEffects();
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

        await this.prewarmPipelines();

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

    computeDriftPosition(timeSeconds = this.time, out = null) {
        // Keep the hero composition behind the board. The former viewport-sized
        // excursion repeatedly moved the black hole off-screen and changed its
        // fill cost by several times as Z wandered by 250 world units.
        const widthRange = 55;
        const heightRange = 32;
        const depthRange = 24;
        const t = timeSeconds * 0.045;

        const x = (Math.sin(t + this.driftPhaseX) + Math.cos(t * 1.34 + this.driftPhaseX)) * 0.5 * widthRange;
        const y = (Math.cos(t * 0.89 + this.driftPhaseY) + Math.sin(t * 1.67 + this.driftPhaseY)) * 0.5 * heightRange;
        const z = (Math.sin(t * 0.73 + this.driftPhaseX) + Math.cos(t * 1.1 + this.driftPhaseY)) * 0.5 * depthRange;

        // Write into the provided scratch object when given (hot path) to avoid per-frame allocation.
        if (out) {
            out.x = x;
            out.y = y;
            out.z = z;
            return out;
        }
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
            this.setMaterialUniformVec3(this.accretionDisk.material, 'uCenter', x, y, z);
        }
        if (this.innerDisk) {
            this.innerDisk.position.x = x;
            this.innerDisk.position.y = y;
            this.innerDisk.position.z = z;
        }
        for (let i = 0; i < this.accretionVolumeLayers.length; i += 1) {
            const layer = this.accretionVolumeLayers[i];
            layer.position.x = x;
            layer.position.y = y;
            layer.position.z = z;
            this.setMaterialUniformVec3(layer?.material, 'uCenter', x, y, z);
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
        if (this.lensedDiskArc) {
            this.lensedDiskArc.position.set(x, y, z - 12);
        }
        if (this.polarJet) {
            this.polarJet.position.set(x, y, z - 20);
        }

        this.setMaterialUniformVec3(this.starfield?.material, 'uBlackHolePos', x, y, z);
        this.setMaterialUniformVec3(this.particles?.material, 'uBlackHolePos', x, y, z);
        this.setMaterialUniformVec3(this.burstSparks?.material, 'uBlackHolePos', x, y, z);
        for (let i = 0; i < this.burstSparkBanks.length; i += 1) {
            this.setMaterialUniformVec3(this.burstSparkBanks[i]?.material, 'uBlackHolePos', x, y, z);
        }
        for (let i = 0; i < this.burstSparksPool.length; i += 1) {
            this.setMaterialUniformVec3(this.burstSparksPool[i]?.material, 'uBlackHolePos', x, y, z);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renderer & Camera
    // ─────────────────────────────────────────────────────────────────────────

    async initRenderer(container, ownerGeneration = this.lifecycleGeneration) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const ownsLifecycle = () => ownerGeneration === this.lifecycleGeneration
            && this.isActive
            && !this.cleanupComplete;

        const createCandidate = async (forceWebGL) => {
            const renderer = new THREE.WebGPURenderer({
                antialias: this.getAntialiasEnabled(),
                powerPreference: 'high-performance',
                alpha: false,
                forceWebGL,
            });
            try {
                await this.initializeRendererCandidate(renderer, {
                    label: `Black Hole ${forceWebGL ? 'WebGL2' : 'WebGPU'} renderer init`,
                    ownerGeneration,
                });
                return renderer;
            } catch (error) {
                renderer.dispose();
                throw error;
            }
        };

        const canAttemptWebGPU = !this.flags.forceWebGL
            && typeof navigator !== 'undefined'
            && Boolean(navigator.gpu);
        let renderer = null;
        if (canAttemptWebGPU) {
            try {
                renderer = await createCandidate(false);
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose();
                    renderer = null;
                }
            } catch (error) {
                if (!ownsLifecycle()) return false;
                console.warn('[BlackHole] WebGPU init failed, falling back to WebGL2:', error);
            }
        }
        if (!renderer) {
            if (!ownsLifecycle()) return false;
            renderer = await createCandidate(true);
        }

        if (!ownsLifecycle()) {
            this.disposeRenderer(renderer, { nullInstance: false });
            return false;
        }
        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;

        console.log(`[BlackHole] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

        this.renderer.setClearColor(0x000005, 1); // Very dark blue-black
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.applyDynamicResolution(width, height);
        this.renderer.sortObjects = this.qualityPreset.sortObjects !== false;
        this.renderer.autoClear = false;

        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);
        this.removeRendererResilience();
        this.setupRendererResilience(this.renderer, {
            webgpuDevice: this.isWebGPU ? this.renderer.backend?.device : null,
        });

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
        return true;
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
                    console.warn(
                        '[BlackHole] Starfield lensing compute init failed, falling back to static stars:',
                        error,
                    );
                    this.starLensingCompute = null;
                    this.flags.useLensing = false;
                }
            }
        }

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

        this.scene.add(this.starfield);
        console.log('[BlackHole] Starfield created with', starCount, 'stars');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Nebula Clouds - Billboard planes with procedural textures
    // ─────────────────────────────────────────────────────────────────────────

    createNebulaTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Layer faint, anisotropic wisps instead of one radial billboard. The
        // result keeps the deep-space color atmosphere without visible circles.
        for (let index = 0; index < 18; index += 1) {
            const x = 256 + (this.random() - 0.5) * 150;
            const y = 256 + (this.random() - 0.5) * 180;
            const radius = 82 + this.random() * 92;
            const alpha = 0.025 + this.random() * 0.035;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((this.random() - 0.5) * Math.PI);
            ctx.scale(1.8 + this.random() * 1.8, 0.18 + this.random() * 0.28);
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
            gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
            gradient.addColorStop(0.38, `rgba(255,255,255,${alpha * 0.55})`);
            gradient.addColorStop(0.78, `rgba(255,255,255,${alpha * 0.16})`);
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
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

        if (cloudCount <= 0) return;

        if (!this.nebulaTexture) {
            this.nebulaTexture = this.createNebulaTexture();
        }

        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = createNebulaCloudNodeMaterial(
            this.nebulaTexture,
            { useInstanceColor: true },
        );
        material.forceSinglePass = true;

        const instanced = new THREE.InstancedMesh(geometry, material, cloudCount);
        // Instance matrices are written once in the build loop below and never per frame (nebula
        // motion is per-mesh rotation.z), so keep the default StaticDrawUsage — DynamicDrawUsage
        // was a stale hint telling the driver to expect re-uploads that never come.
        instanced.frustumCulled = false;
        instanced.renderOrder = -10;

        const colors = new Float32Array(cloudCount * 3);
        instanced.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

        const tempMatrix = new THREE.Matrix4();
        const tempPosition = new THREE.Vector3();
        const tempScale = new THREE.Vector3();
        const tempQuaternion = new THREE.Quaternion();
        const tempColor = new THREE.Color();
        // Face each cloud back toward the origin so that, distributed over the full sphere,
        // whichever clouds fall behind the black hole (the visible backdrop for the current
        // camera angle) read face-on rather than edge-on.
        const planeNormal = new THREE.Vector3(0, 0, 1);
        const towardOrigin = new THREE.Vector3();
        const rollQuat = new THREE.Quaternion();

        for (let i = 0; i < cloudCount; i++) {
            const size = 1200 + this.random() * 1400;

            // Distribute uniformly over a full sphere shell (all directions) instead of the
            // old -Z-only box, so the clouds surround the black hole and stay in frame as the
            // camera orbits all the way around.
            const theta = 2 * Math.PI * this.random();
            const phi = Math.acos(2 * this.random() - 1);
            const nebulaRadius = 2000 + this.random() * 1500;
            const sinPhi = Math.sin(phi);
            tempPosition.set(
                sinPhi * Math.cos(theta) * nebulaRadius,
                sinPhi * Math.sin(theta) * nebulaRadius,
                Math.cos(phi) * nebulaRadius,
            );

            // Orient the quad's +Z normal toward the origin, then add a random roll around
            // that axis for organic variety.
            towardOrigin.copy(tempPosition).normalize().negate();
            tempQuaternion.setFromUnitVectors(planeNormal, towardOrigin);
            rollQuat.setFromAxisAngle(towardOrigin, this.random() * Math.PI * 2);
            tempQuaternion.premultiply(rollQuat);

            tempScale.set(size, size * (0.34 + this.random() * 0.24), 1);

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
        const material = createBlackHoleCoreNodeMaterial({
            noiseOctaves: this.qualityPreset.materialNoiseOctaves ?? 3,
        });
        material.forceSinglePass = true;

        this.blackHoleCore = new THREE.Mesh(geometry, material);
        this.blackHoleCore.position.set(0, 0, 0);
        this.blackHoleCore.renderOrder = 100;
        this.scene.add(this.blackHoleCore);

        // Inner black sphere (solid event horizon) - LARGER
        // Only the top tiers carry the extra tessellation; High and below cap at 32. (This previously
        // inverted: every tier EXCEPT High used 48, so low-end HW paid for more geometry than High on
        // a featureless black occluder where 32 is already perfectly round at screen scale.)
        const horizonQuality = this.getCurrentQualityLevel();
        const horizonSegments = (horizonQuality === 'Ultra' || horizonQuality === 'Extreme') ? 48 : 32;
        const blackGeometry = new THREE.SphereGeometry(120, horizonSegments, horizonSegments);
        const blackMaterial = createEventHorizonNodeMaterial();
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

        const geometry = new THREE.PlaneGeometry(620, 620);
        const material = createPhotonSphereNodeMaterial();
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
        const baseGeometry = new THREE.RingGeometry(innerRadius, outerRadius, segments, 1);

        // Core opaque disk material
        const material = createAccretionDiskNodeMaterial({
            noiseOctaves: this.qualityPreset.materialNoiseOctaves ?? 3,
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

        console.log('[BlackHole] Accretion disk created');
    }

    createRelativisticEffects() {
        const disposeMesh = (mesh) => {
            if (!mesh) return;
            this.scene.remove(mesh);
            mesh.geometry?.dispose?.();
            mesh.material?.dispose?.();
        };
        disposeMesh(this.lensedDiskArc);
        disposeMesh(this.polarJet);
        disposeMesh(this.lockRipple);
        disposeMesh(this.matterStream);

        this.lensedDiskArc = new THREE.Mesh(
            new THREE.PlaneGeometry(760, 540),
            createLensedDiskArcNodeMaterial(),
        );
        this.lensedDiskArc.renderOrder = 52;
        this.scene.add(this.lensedDiskArc);

        this.polarJet = new THREE.Mesh(
            new THREE.PlaneGeometry(190, 760),
            createPolarJetNodeMaterial(),
        );
        this.polarJet.renderOrder = 47;
        this.scene.add(this.polarJet);

        this.lockRipple = new THREE.Mesh(
            new THREE.PlaneGeometry(220, 220),
            createLockRippleNodeMaterial(),
        );
        this.lockRipple.position.z = 90;
        this.lockRipple.renderOrder = 120;
        this.scene.add(this.lockRipple);

        this.matterStream = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            createMatterStreamNodeMaterial(),
        );
        this.matterStream.position.z = 82;
        this.matterStream.renderOrder = 119;
        this.scene.add(this.matterStream);
        this.applyBlackHoleDriftState();
    }

    placeGameplayFx(origin) {
        const centered = origin?.centered || { x: 0, y: 0 };
        const x = THREE.MathUtils.clamp(centered.x, -1, 1) * 220;
        const y = THREE.MathUtils.clamp(centered.y, -1, 1) * 300;
        this.fxOrigin.set(x, y, 90);
        this.lockRipple?.position.copy(this.fxOrigin);
        this.updateMatterStreamPlacement();
    }

    updateMatterStreamPlacement() {
        if (!this.matterStream) return;
        const { x, y } = this.fxOrigin;
        const targetX = this.driftX || 0;
        const targetY = this.driftY || 0;
        this.fxStreamVector.set(targetX - x, targetY - y);
        const length = Math.max(1, this.fxStreamVector.length());
        this.matterStream.scale.set(length, 34, 1);
        this.matterStream.position.set((x + targetX) * 0.5, (y + targetY) * 0.5, 82);
        this.matterStream.rotation.z = Math.atan2(this.fxStreamVector.y, this.fxStreamVector.x);
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
        // Ambient stardust is GPU-simulated on WebGPU. The integration (gravity pull, orbital
        // assist, plane damping, out-of-bounds reset) runs in BlackHoleParticleCompute over one
        // persistent storage buffer, and the point material reads positions straight from it — no
        // per-frame CPU loop over thousands of motes and no per-frame attribute upload. The kernel
        // is a faithful port of the CPU integrator (same reference-cadence damping constants), so
        // the dust reads the same. The CPU integrator further down stays as the WebGL2 / no-compute
        // fallback (used whenever particleCompute is null).
        if (this.isWebGPU && this.flags.useCompute) {
            try {
                this.particleCompute = new BlackHoleParticleCompute(particleCount);
                this.particleCompute.setInitialState(positions, velocities, colors, sizes, lifetimes, randoms);
                this.particleCompute.createComputeNode();
            } catch (error) {
                console.warn('[BlackHole] Ambient particle compute init failed, using CPU dust:', error);
                this.particleCompute?.dispose?.();
                this.particleCompute = null;
                // Leave useCompute on so the GPU burst-spark banks are unaffected; the CPU
                // integrator transparently drives the ambient dust when particleCompute is null.
            }
        }

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

        this.hawkingAttributes = {
            position: this.hawkingParticles.geometry.getAttribute('instancePosition'),
            color: this.hawkingParticles.geometry.getAttribute('instanceColor'),
            size: this.hawkingParticles.geometry.getAttribute('instanceSize'),
            lifetime: this.hawkingParticles.geometry.getAttribute('instanceLifetime'),
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
            this.hawkingParticles?.count ?? lifetimes.length,
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

        this.setMaterialUniformVec3(
            this.hawkingParticles?.material,
            'uBlackHolePos',
            this.driftX || 0,
            this.driftY || 0,
            this.driftZ || 0,
        );
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
        this.postProcessing?.setSize(width, height);
    }

    updateDynamicResolution(delta) {
        const drs = this.dynamicResolution;
        if (!drs?.enabled || !this.renderer) return;

        // Prefer measured GPU render cost over presentation delta. Presentation delta
        // (clock.getDelta) is polluted by vsync waits, GC hitches, background-tab
        // throttling, and the reduced-mode cadence — none of which reflect how hard the
        // scene is to draw. Measured render time is the true fill-cost signal. Fall back
        // to frame delta when timestamp queries are unavailable (WebGL2 / unsupported
        // hardware) or the last GPU sample is stale.
        const frameMs = delta * 1000;
        const gpuFresh = drs.gpu.valid
            && drs.gpu.ms > 0
            && (this.time - drs.gpu.lastSampleAt) < 0.5;
        const usingGpu = gpuFresh && !this.flags.noGpuDrs;
        const workMs = usingGpu ? drs.gpu.ms : frameMs;
        const targetMs = usingGpu ? drs.gpuTargetMs : drs.targetMs;

        // The two signals live on different time-bases (render-only vs full frame). On a
        // source switch, re-anchor the EMA to the new target so the scale mismatch can't
        // trigger a spurious up/down step.
        if (drs.usingGpu !== usingGpu) {
            drs.usingGpu = usingGpu;
            drs.emaMs = targetMs;
        }

        if (drs.warmupRemaining > 0) {
            drs.warmupRemaining = Math.max(0, drs.warmupRemaining - delta);
            drs.emaMs = targetMs;
            return;
        }
        // Pipeline compilation, tab restoration, and GC are not sustained fill
        // pressure. Ignoring isolated 4x-budget hitches keeps DRS from degrading
        // the scene for seconds after a one-off stall.
        if (workMs > targetMs * 4) return;
        drs.emaMs = drs.emaMs * 0.9 + workMs * 0.1;
        drs.elapsed += delta;
        drs.cooldownRemaining = Math.max(0, drs.cooldownRemaining - delta);
        if (drs.elapsed < drs.adjustInterval) return;
        drs.elapsed = 0;
        if (drs.cooldownRemaining > 0) return;

        let newScale = drs.scale;
        // Down-scale more aggressively when the EMA is significantly over budget (combos / burst
        // surges), and step gently on the way back up so we don't oscillate.
        if (drs.emaMs > targetMs * 1.2) {
            newScale = Math.max(drs.minScale, drs.scale - 0.08);
        } else if (drs.emaMs > targetMs * 1.12) {
            newScale = Math.max(drs.minScale, drs.scale - 0.05);
        } else if (drs.emaMs < targetMs * 0.85) {
            newScale = Math.min(drs.maxScale, drs.scale + 0.05);
        }

        if (Math.abs(newScale - drs.scale) >= 0.01) {
            drs.scale = newScale;
            drs.cooldownRemaining = 0.75;
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
            if (this.starfield.count !== targetCount) {
                this.starfield.count = targetCount;
                this.lodState.starCount = targetCount;
            }
        }

        if (this.particles) {
            const baseCount = this.particles.userData.baseCount || this.qualityPreset.particleCount;
            const targetCount = Math.min(baseCount, Math.max(160, Math.floor(baseCount * particleFactor)));
            if (this.particles.count !== targetCount) {
                this.particles.count = targetCount;
                this.lodState.particleCount = targetCount;
            }
        }

        if (this.hawkingParticles) {
            const baseCount = this.hawkingParticles.userData.baseCount || this.getHawkingParticleCount();
            const targetCount = Math.min(baseCount, Math.max(60, Math.floor(baseCount * hawkingFactor)));
            if (this.hawkingParticles.count !== targetCount) {
                this.hawkingParticles.count = targetCount;
                this.lodState.hawkingCount = targetCount;
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
        const baseInterval = this.qualityPreset.particleComputeInterval ?? 0;
        // During a combo the dust moves FAST (surge suction), so the sim must update every frame to
        // look smooth — throttling here reads as "low Hz" stepping precisely when the motion is
        // fastest. GPU compute is cheap, so run the ambient sim at full frame rate (Extreme, base 0)
        // or at least 60 Hz (lower tiers) while a combo is active; only throttle slow idle drift.
        if (active) return Math.min(baseInterval, 1 / 60);
        return baseInterval;
    }

    getHawkingUpdateInterval() {
        const active = this.hawkingIntensity > 1.08
            || this.hawkingTargetIntensity > 1.08
            || this.photonSpherePulse > 0.08
            || this.burstFactor > 0.08;
        // Cap the active-state update rate instead of running every frame. Hawking has NO GPU
        // compute path (unlike the other particle systems), so an interval of 0 during combos ran
        // its ~448-particle CPU integration loop + 3 InstancedBufferAttribute uploads on EVERY
        // frame — precisely when the GPU is busiest with the disk raymarch + burst. Bounding it to
        // ~30 Hz (or the idle tier rate if faster) is imperceptible on these tiny background sprites.
        if (active) return Math.min(this.qualityPreset.hawkingUpdateInterval ?? (1 / 30), 1 / 30);
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

    // Resolve the render-pass timestamp pool (populated by trackTimestamp) and feed the
    // measured GPU render cost into the dynamic-resolution EMA. Guarded against overlap so
    // we never have two resolves in flight, and fully self-healing: any failure or missing
    // sample simply leaves drs.gpu stale, and DRS transparently falls back to frame delta.
    sampleRenderGpuTiming() {
        if (!this.gpuTimings?.enabled || this.gpuTimings.renderPending) return;
        // Sample the render-pass cost at ~15 Hz rather than every frame. It feeds the
        // dynamic-resolution EMA, which is consumed at 2 Hz (drs.adjustInterval) and already
        // smoothed; sampling faster only adds a per-frame resolveTimestampsAsync().then().catch()
        // Promise chain with no effect on the scale decision. At steady state on a GPU that never
        // downscales this is behaviourally identical.
        if (this.time < this.gpuTimings.nextRenderSampleAt) return;
        this.gpuTimings.nextRenderSampleAt = this.time + (1 / 15);
        const { renderer } = this;
        if (!renderer?.backend?.trackTimestamp) return;
        const ownerGeneration = this.lifecycleGeneration;
        const timingState = this.gpuTimings;
        timingState.renderPending = true;

        let resolvePromise;
        try {
            resolvePromise = renderer.resolveTimestampsAsync(TimestampQuery.RENDER);
        } catch {
            timingState.renderPending = false;
            return;
        }

        resolvePromise
            .then((duration) => {
                // Timestamp resolves outlive a frame and may finish after stop()/cleanup().
                // Never publish a result into a later start of this same mutable theme object.
                if (ownerGeneration !== this.lifecycleGeneration
                    || renderer !== this.renderer
                    || timingState !== this.gpuTimings
                    || !this.isActive
                    || this.cleanupComplete
                    || !timingState.enabled) {
                    return;
                }
                timingState.renderPending = false;
                if (typeof duration !== 'number' || !(duration > 0)) return;
                const drs = this.dynamicResolution;
                if (!drs?.gpu) return;
                // Short EMA — the render timestamp already integrates the whole pass, so a
                // light smoothing is enough to reject single-frame jitter.
                drs.gpu.ms = drs.gpu.valid ? drs.gpu.ms * 0.8 + duration * 0.2 : duration;
                drs.gpu.valid = true;
                drs.gpu.lastSampleAt = this.time;
            })
            .catch(() => {
                // A stale completion must not clear a newer generation's pending sample.
                if (ownerGeneration === this.lifecycleGeneration
                    && renderer === this.renderer
                    && timingState === this.gpuTimings) {
                    timingState.renderPending = false;
                }
            });
    }

    async updateGpuTimings() {
        const { renderer } = this;
        const timingState = this.gpuTimings;
        if (!timingState?.enabled || !renderer?.backend) return;
        const ownerGeneration = this.lifecycleGeneration;
        const now = performance.now();
        // Drain the compute-timestamp pool at ~2 Hz. trackTimestamp now runs in normal
        // play (for DRS), so the compute pool must be resolved often enough that it never
        // approaches the query-pool cap and emits a warning.
        if (now - timingState.lastResolve < 500) return;
        timingState.lastResolve = now;

        try {
            await renderer.resolveTimestampsAsync(TimestampQuery.COMPUTE);

            // cleanup() disposes the renderer synchronously while timestamp resolution is
            // asynchronous. Use the captured identity and lifecycle generation on both
            // sides of the await so a late completion cannot touch the retired runtime.
            if (ownerGeneration !== this.lifecycleGeneration
                || renderer !== this.renderer
                || timingState !== this.gpuTimings
                || !this.isActive
                || this.cleanupComplete
                || !timingState.enabled
                || !renderer.backend) {
                return;
            }

            const { backend } = renderer;
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

            timingState.compute = compute;

            if (this.flags.baseline && Object.keys(compute).length) {
                console.log('[BlackHole] GPU compute timings (ms):', compute);
            }
        } catch {
            // Timing telemetry is opportunistic. A disposed backend or a failed query must
            // never reject into the animation loop.
            return;
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
            // Start off the render path — the per-frame reconcile in the animation loop
            // reveals a bank only while it holds active particles. (Prewarm temporarily
            // exposes it so its pipeline still compiles up front.)
            burstSparks.visible = false;

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
                ({ remaining } = result);
            }
            this.nextBurstBankIndex = bankCount > 0 ? (startIndex + 1) % bankCount : 0;

            if (remaining <= 0) break;
            if (!this.ensureBurstCapacityFor(remaining)) break;
            iterations += 1;
            if (iterations > 8) break;
        }

        const activated = Math.max(0, Math.floor(requestedCount) - remaining);
        if (remaining > 0 && queueOnOverflow) {
            const maxQueuedRequests = 8;
            const maxQueuedParticles = Math.max(this.burstCapacityMax, this.burstCapacityBase, 1);
            if (this.burstRequestQueue.length >= maxQueuedRequests) {
                const tail = this.burstRequestQueue[this.burstRequestQueue.length - 1];
                tail.count = Math.min(maxQueuedParticles, tail.count + remaining);
                tail.seed = seed;
                // Keep the tail's original enqueue time so a perpetually-coalesced tail
                // still expires by age rather than being refreshed forever.
            } else {
                this.burstRequestQueue.push({
                    count: Math.min(maxQueuedParticles, remaining),
                    seed,
                    // Stamp so drainBurstRequestQueue can expire stale requests (§4.3).
                    enqueuedAt: this.time,
                });
            }
        }
        return { activated, remaining };
    }

    drainBurstRequestQueue() {
        if (!this.burstRequestQueue.length || !this.burstComputeBanks.length) return;

        // Expire requests that have waited too long. A burst that fires more than ~250 ms
        // after the combo/lock that spawned it reads as disconnected from its event, so we
        // drop it rather than play it late (Definition of Success: no delayed bursts older
        // than 250 ms). The queue is FIFO with monotonic enqueue times, so the head is
        // always the oldest — dropping from the front is sufficient.
        const maxRequestAge = 0.25;
        while (this.burstRequestQueue.length
            && (this.time - (this.burstRequestQueue[0].enqueuedAt ?? this.time)) > maxRequestAge) {
            this.burstRequestQueue.shift();
        }
        if (!this.burstRequestQueue.length) return;

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
            }

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
            burstSparks.visible = false;
            this.burstSparksPool.push(burstSparks);
            this.scene.add(burstSparks);
        }

        console.log(
            '[BlackHole] Burst sparks pool created with',
            this.burstPoolSize,
            'systems,',
            particlesPerBurst,
            'particles each',
        );
    }

    pickAmbientParticleColor(colorPalette) {
        const roll = this.random();
        if (roll < 0.38) return colorPalette[0];
        if (roll < 0.7) return colorPalette[1];
        if (roll < 0.88) return colorPalette[2];
        if (roll < 0.96) return colorPalette[3];
        return colorPalette[4];
    }

    initParticle(
        index,
        positions,
        velocities,
        colors,
        sizes,
        lifetimes,
        colorPalette,
        centerX = 0,
        centerY = 0,
        centerZ = 0,
    ) {
        const i3 = index * 3;

        // Spawn in a tighter torus around the accretion disk.
        const angle = this.random() * Math.PI * 2;
        const radius = 260 + this.random() * 360;
        const height = (this.random() - 0.5) * 70;

        // RingGeometry lives in local XY. Transform its U/V/N basis by the
        // mesh's -X tilt so CPU, WebGPU compute, and the visible disk agree.
        const px = Math.cos(angle) * radius;
        const diskV = Math.sin(angle) * radius;

        // Apply tilt rotation (around X axis) - matches disk rotation
        const cosT = this.diskCosTilt;
        const sinT = this.diskSinTilt;

        const py = diskV * cosT + height * sinT;
        const pz = -diskV * sinT + height * cosT;

        positions[i3] = centerX + px;
        positions[i3 + 1] = centerY + py;
        positions[i3 + 2] = centerZ + pz;

        // Initial velocity - Orbital motion (increased slightly to maintain orbit without forcing)
        const orbitalSpeed = 0.28 + this.random() * 0.22;

        // Tangential velocity on flat plane
        const vx = -Math.sin(angle) * orbitalSpeed;
        const diskVVelocity = Math.cos(angle) * orbitalSpeed;
        const normalVelocity = (this.random() - 0.5) * 0.03;
        const vy = diskVVelocity * cosT + normalVelocity * sinT;
        const vz = -diskVVelocity * sinT + normalVelocity * cosT;

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

        if (!this.flags.usePost) return;

        this.postProcessing = new BlackHolePost(this.renderer, this.scene, this.camera, {
            useMRT: this.flags.useMRT,
            bloomStrength: this.qualityPreset.bloomStrength,
            bloomRadius: this.qualityPreset.bloomRadius,
            bloomThreshold: 0.3,
            bloomDownsample: this.performanceState.bloomDownsample,
            enableChromatic: false,
            chromaticStrength: 0,
            enableLensing: this.flags.usePostLensing,
            lensCenter: new THREE.Vector2(0.5, 0.5),
            lensStrength: 0.016,
            lensRadius: 0.36,
            lensInnerRadius: 0.105,
            vignetteOffset: 1.2,
            vignetteDarkness: 0.5,
            exposure: 0.96,
            contrast: 1.04,
            saturation: 1.04,
            tintStrength: 0.12,
            ditherStrength: 0.0012,
        });
        this.postProcessing.setSize(window.innerWidth, window.innerHeight);
        console.log('[BlackHole] Unified TSL post-processing setup complete');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Event Listeners
    // ─────────────────────────────────────────────────────────────────────────

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.onLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.onCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            if (this.isActive && window.settings?.backgroundComboEffects !== false) {
                this.onPieceLock(data);
            }
        });

        const viewportUnsub = eventBus.on(EVENTS.VIEWPORT_RESIZED, (viewport) => {
            this.resize(viewport?.width || window.innerWidth, viewport?.height || window.innerHeight);
        });

        // Pointer tracking for parallax camera
        const onPointerMove = (e) => {
            if (!this.isActive) return;
            this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
            this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
        };
        window.addEventListener('pointermove', onPointerMove);
        const pointerUnsub = () => window.removeEventListener('pointermove', onPointerMove);

        const onSettingsChanged = (event) => {
            const changed = event?.detail || {};
            const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
            this.fxController.configure({
                reducedMotion,
                intensityMultiplier: window.settings?.backgroundComboEffects === false ? 0 : 1,
            });
            if (Object.prototype.hasOwnProperty.call(changed, 'targetFrameRate')) {
                const target = Math.max(30, Number(window.settings?.targetFrameRate) || 60);
                this.dynamicResolution.targetMs = 1000 / target;
            }
            if (Object.prototype.hasOwnProperty.call(changed, 'effectQuality')) {
                this.applyQualityPreset(this.getCurrentQualityLevel());
                this.updateCapabilityFlags();
                this.renderer.sortObjects = this.qualityPreset.sortObjects !== false;
                this.setupPostProcessing();
                this.applyDynamicResolution();
                this.applyLod();
            }
        };
        window.addEventListener('settingsChanged', onSettingsChanged);
        const settingsUnsub = () => window.removeEventListener('settingsChanged', onSettingsChanged);

        this.eventUnsubscribers.push(
            lineClearUnsub,
            comboUnsub,
            pieceLockUnsub,
            viewportUnsub,
            pointerUnsub,
            settingsUnsub,
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Game Event Effects
    // ─────────────────────────────────────────────────────────────────────────

    onPieceLock(payload = {}) {
        this.fxController.onPieceLock(payload);
    }

    onLineClear(payload = {}) {
        this.fxController.onLineClear(Number.isFinite(payload) ? { lineCount: payload } : payload);
    }

    onCombo(payload = {}) {
        this.fxController.onCombo(Number.isFinite(payload) ? { comboCount: payload } : payload);
    }

    processGameplayFx(delta) {
        this.fxSignals = this.fxController.step(delta);
        const commands = this.fxController.drainCommands();
        for (let index = 0; index < commands.length; index += 1) {
            const command = commands[index];
            switch (command.type) {
            case BLACK_HOLE_FX_COMMAND.PIECE_LOCK:
                this.applyPieceLockCommand(command);
                break;
            case BLACK_HOLE_FX_COMMAND.LINE_CLEAR:
                this.applyLineClearCommand(command);
                break;
            case BLACK_HOLE_FX_COMMAND.COMBO:
                this.applyComboCommand(command);
                break;
            default:
                break;
            }
        }

        const lockCore = this.fxSignals.delayedCore || 0;
        if (lockCore > 0) {
            this.coreTargetIntensity = Math.min(2.1, Math.max(
                this.coreTargetIntensity,
                1 + lockCore * 1.4,
            ));
            this.photonSpherePulse = Math.max(this.photonSpherePulse, lockCore * 0.38);
        }
        this.comboVisualEnergy = Math.max(
            this.fxSignals.comboEnergy || 0,
            this.fxSignals.caustic || 0,
            this.fxSignals.stellarArc || 0,
        );
    }

    applyPieceLockCommand(command) {
        this.placeGameplayFx(command.origin);
        const gain = command.intensity || 0;
        // The controller's delayed-core envelope owns the impact beat. These
        // immediate layers are deliberately restrained so compression ->
        // ripple/stream -> horizon response remains legible.
        this.starFlashIntensity = Math.min(1.0, this.starFlashIntensity + gain * 0.22);
        this.bloomPulseIntensity = Math.min(0.55, this.bloomPulseIntensity + gain * 0.12);
        this.hawkingTargetIntensity = Math.min(1.6, this.hawkingTargetIntensity + gain * 0.16);
        this.particleEventBoost = Math.min(1.0, this.particleEventBoost + gain * 0.8);
    }

    applyLineClearCommand(command) {
        const { lineCount } = command;
        this.placeGameplayFx(command.origin);
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

    applyComboCommand(command) {
        const { comboCount } = command;
        if (!this.isActive || comboCount < 2) return;
        this.placeGameplayFx(command.origin);
        this.comboPhenomenon = command.phenomenon;
        this.comboDirectives = command.directives;

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
        // NOTE: the ambient dust compute is deliberately NOT suspended here anymore. Freezing it for
        // ~1.65 s after each burst made the gravity settle look choppy/"low Hz" exactly when the
        // player is watching the post-combo suck-in. The dust runs on its own GPU buffer and its
        // compute is dispatched before the frame's render, so it can run every frame with no hazard.

        // Keep combo forces additive: bursts add energy instead of subtracting suction.
        this.gravitySurgeFactor = Math.min(40.0, this.gravitySurgeFactor + surgeGain * 0.35);
        this.burstPhase = true;
        this.burstFactor = Math.min(40.0, this.burstFactor + burstGain);

        this.starFlashIntensity = Math.min(1.8, this.starFlashIntensity + 0.18 + comboCount * 0.12);
        this.bloomPulseIntensity = Math.min(1.2, this.bloomPulseIntensity + 0.14 + comboCount * 0.08);
        this.chromaticPulse = Math.min(0.03, this.chromaticPulse + 0.004 + comboCount * 0.0015);

        // Prefer dedicated burst systems (like Galaxy/Blood Moon behavior).
        if (this.isWebGPU && this.flags.useCompute && this._hasAnyBurstComputeNode) {
            // Bigger combos throw more, larger waves. The buffer is large and idle-gated, so up to
            // three staggered emissions per combo is affordable; intensity is allowed to reach 1.0 so
            // a high combo actually hits the preset's max batch factor rather than topping out at ~0.9.
            const triggerCount = Math.min(1 + Math.floor(comboCount / 4), 3);
            for (let i = 0; i < triggerCount; i++) {
                const intensity = Math.min(1.0, comboCount / 9 + i * 0.08);
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
                const isIdleByTimer = pulseTimer === undefined || pulseTimer <= -50.0 || pulseTimer > 1.6;

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
                    burstSparks.visible = true;
                    triggered += 1;
                }

                scanned += 1;
            }

            this.nextBurstIndex = (startIndex + scanned) % this.burstSparksPool.length;
            const shortfall = systemsToTrigger - triggered;
            if (shortfall > 0) {
                this.pendingBurstPoolTriggers = Math.min(
                    this.burstPoolSize * 2,
                    this.pendingBurstPoolTriggers + shortfall,
                );
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
                const diskV = Math.sin(angle) * shellRadius;
                const diskH = (this.random() - 0.5) * 30;

                const x = bhX + diskX;
                const y = bhY + diskV * burstCosT + diskH * burstSinT;
                const z = bhZ - diskV * burstSinT + diskH * burstCosT;

                const vx = Math.cos(angle) * speed;
                const vy = Math.sin(angle) * speed * burstCosT;
                const vz = -Math.sin(angle) * speed * burstSinT;

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

        const total = this.particles?.count ?? (positions.length / 3);
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
            const diskV = Math.sin(angle) * shellRadius;
            const diskH = (this.random() - 0.5) * 30;

            positions[i3] = bhX + diskX;
            positions[i3 + 1] = bhY + diskV * cpuBurstCosT + diskH * cpuBurstSinT;
            positions[i3 + 2] = bhZ - diskV * cpuBurstSinT + diskH * cpuBurstCosT;

            const speed = 18 + this.random() * 28 + comboCount * 3;

            velocities[i3] = Math.cos(angle) * speed;
            velocities[i3 + 1] = Math.sin(angle) * speed * cpuBurstCosT;
            velocities[i3 + 2] = -Math.sin(angle) * speed * cpuBurstSinT;

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
                const vy = direction * speed * this.diskSinTilt;
                const vz = direction * speed * this.diskCosTilt;

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

        const total = this.particles?.count ?? (positions.length / 3);
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
            velocities[i3 + 1] = direction * speed * this.diskSinTilt;
            velocities[i3 + 2] = direction * speed * this.diskCosTilt;

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

        const swayScale = 0.5 + comboEnergy * 0.32;
        const swayX = (
            Math.sin(t * 0.22 + this.cameraPhaseX) * 8.5
            + Math.cos(t * 0.09 + this.cameraPhaseY) * 5.2
        ) * swayScale;
        const swayY = (
            Math.cos(t * 0.18 + this.cameraPhaseY) * 5.8
            + Math.sin(t * 0.11 + this.cameraPhaseZ) * 3.8
        ) * swayScale;

        const followX = this.driftX * 0.08;
        const followY = this.driftY * 0.06;
        const followZ = (this.driftZ || 0) * 0.15; // Camera slightly follows Z depth
        const surgePushIn = comboEnergy * 24;

        // Smooth pointer tracking for mouse parallax. The camera sits ~1040 units back, so
        // the excursion has to be sizeable to read as a real "peer around the black hole"
        // rather than a couple of pixels. The look target below follows the pointer at a
        // fraction of this, so the shadow shifts across the frame and the far-side lensing
        // reveals differently as you move — the effect that best sells a black hole.
        this.smoothedPointerX = THREE.MathUtils.lerp(this.smoothedPointerX, this.pointerX, delta * 3.4);
        this.smoothedPointerY = THREE.MathUtils.lerp(this.smoothedPointerY, this.pointerY, delta * 3.4);
        const parallaxX = this.smoothedPointerX * 96.0;
        const parallaxY = -this.smoothedPointerY * 54.0;

        // ── Cinematic orbital float ──────────────────────────────────────────────
        // The camera circles ALL THE WAY AROUND the black hole (continuous azimuth) while the
        // elevation floats and the radius dollies in and out. Because the look target below
        // keeps the shadow framed in camera space, the full revolution reads as "floating
        // around it" — the disc tilt and far-side lensing sweep through every angle, including
        // the back, while the hole stays composed. All slow + smoothly interpolated.
        // + t * 0.075 = one full revolution every ~84 s; the sines add organic wobble.
        const azimuth = this.cameraAzimuthBase
            + t * 0.075
            + Math.sin(t * 0.021 + this.cameraPhaseA) * 0.30
            + Math.sin(t * 0.043 + this.cameraPhaseB) * 0.12;
        // Big vertical float, kept above the disc plane.
        const elevation = this.cameraElevationBase + 0.10
            + Math.sin(t * 0.029 + this.cameraPhaseC) * 0.15
            + Math.sin(t * 0.017 + this.cameraPhaseD) * 0.06;
        // Dolly in/out: radius swings ~±26% so the hole clearly zooms toward and away.
        const zoom = 1
            + Math.sin(t * 0.038 + this.cameraPhaseD) * 0.2
            + Math.sin(t * 0.013 + this.cameraPhaseA) * 0.08;
        const orbitRadius = this.cameraOrbitRadius * zoom - surgePushIn;
        const cosEl = Math.cos(elevation);
        const baseX = Math.sin(azimuth) * cosEl * orbitRadius;
        const baseY = Math.sin(elevation) * orbitRadius;
        const baseZ = Math.cos(azimuth) * cosEl * orbitRadius;

        this.cameraTargetPosition.set(
            baseX + followX + swayX + parallaxX,
            baseY + followY + swayY + parallaxY,
            baseZ + followZ,
        );

        const moveLerp = Math.min(1.0, delta * (1.8 + comboEnergy * 0.9));
        this.camera.position.lerp(this.cameraTargetPosition, moveLerp);

        // ── Off-centre framing (camera-relative) ─────────────────────────────────
        // The game board occupies the CENTRE of the screen, so bias the look target within
        // the camera's own right/up axes to keep the black hole out of the dead centre and in
        // the visible side gaps, drifting slowly between them. Doing this in camera space (not
        // world space) means the shadow stays off-centre on SCREEN no matter where the full
        // orbit has carried the camera. Mouse parallax rides the same axes for a true peer.
        const bhX = this.driftX || 0;
        const bhY = this.driftY || 0;
        const bhZ = this.driftZ || 0;
        this._camFwd.set(bhX - this.camera.position.x, bhY - this.camera.position.y, bhZ - this.camera.position.z)
            .normalize();
        this._camRight.crossVectors(this._camFwd, this._worldUp).normalize();
        this._camUp.crossVectors(this._camRight, this._camFwd).normalize();

        const frameBiasX = (
            Math.sin(t * 0.019 + this.cameraPhaseB) * 0.72
            + Math.sin(t * 0.041 + this.cameraPhaseD) * 0.34
        ) * 330;
        const frameBiasY = -50 + Math.sin(t * 0.023 + this.cameraPhaseC) * 60;
        const screenRight = frameBiasX
            + Math.sin(t * 0.2 + this.cameraPhaseX) * (2.6 + comboEnergy * 1.8)
            + parallaxX * 0.32;
        const screenUp = frameBiasY
            + Math.cos(t * 0.17 + this.cameraPhaseY) * (1.9 + comboEnergy * 1.5)
            + parallaxY * 0.32;

        this.cameraLookTarget.set(bhX, bhY, bhZ)
            .addScaledVector(this._camRight, screenRight)
            .addScaledVector(this._camUp, screenUp);
        const lookLerp = Math.min(1.0, delta * (2.4 + comboEnergy * 1.2));
        this.cameraLookTargetSmoothed.lerp(this.cameraLookTarget, lookLerp);
        this.camera.lookAt(this.cameraLookTargetSmoothed);

        // Subtle cinematic roll + focal breathing so the scene feels alive at idle,
        // plus a gentle bank toward the pointer so horizontal mouse motion feels embodied.
        const rollTarget = (
            Math.sin(t * 0.08 + this.cameraPhaseY) * 0.0022
            + Math.cos(t * 0.13 + this.cameraPhaseZ) * 0.0016
        ) * (1.0 + comboEnergy * 0.3)
            - this.smoothedPointerX * 0.016;
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

    /**
     * Prewarm every heavy pipeline behind the mode-entry transition so the first visible
     * frames don't hitch. compileAsync only covers scene render materials; the post-processing
     * node graph and the standalone GPU compute passes (particle / burst / lensing) otherwise
     * compile lazily on their first dispatch. Runs on BOTH backends — previously this was gated
     * to the WebGL2 fallback (`!useMRT`), so the default WebGPU path prewarmed nothing. Every
     * step is individually guarded: a warm failure must never block scene start.
     */
    async prewarmPipelines() {
        if (!this.renderer) return;

        // Reveal BOTH burst systems (the analytic fallback pool and the GPU compute spark
        // banks, which start hidden per §4.4) during the warm pass — invisible objects are
        // skipped by both compileAsync and render(), so their point/sprite pipelines would
        // otherwise compile lazily on the first player combo. Restored afterwards.
        const burstSprites = [...this.burstSparksPool, ...this.burstSparkBanks];
        const burstVisibility = burstSprites.map((sprite) => sprite.visible);
        burstSprites.forEach((sprite) => { sprite.visible = true; });

        try {
            // 1) Standalone GPU compute pipelines — independent of any render-target config.
            // One dispatch each compiles the pipeline; sim state is at-rest so it is a no-op.
            if (this.isWebGPU && this.flags.useCompute && this.renderer.computeAsync) {
                const computeNodes = [];
                if (this.particleCompute?.computeNode) computeNodes.push(this.particleCompute.computeNode);
                this.burstComputeBanks.forEach((bank) => {
                    if (bank?.computeNode) computeNodes.push(bank.computeNode);
                });
                if (this.starLensingCompute?.computeNode) computeNodes.push(this.starLensingCompute.computeNode);
                try {
                    await Promise.all(computeNodes.map((node) => this.renderer.computeAsync(node)));
                } catch (error) {
                    console.warn('[BlackHole] compute warmup failed:', error);
                }
            }

            // 2) Render + post pipelines — warmed in the SAME context they render in.
            // With post enabled (default WebGPU/MRT path AND WebGL2+post), a single real
            // postProcessing.render() compiles every scene material against the correct MRT
            // framebuffer plus the post node graph. This is exactly the per-frame path, so it
            // can never produce a pipeline the animation loop wouldn't.
            // NB: renderer.compileAsync(scene) must NOT be used on the MRT path — it compiles
            // the non-MRT materials against the 2-target framebuffer and yields invalid
            // pipelines ("targets[1] has no fragment output"), which poison the pipeline cache
            // and blank the scene. compileAsync is only correct on the non-post path.
            try {
                if (this.postProcessing && this.flags.usePost) {
                    this.postProcessing.render();
                } else if (this.renderer.compileAsync) {
                    await this.renderer.compileAsync(this.scene, this.camera);
                }
            } catch (error) {
                console.warn('[BlackHole] render warmup failed:', error);
            }
        } finally {
            burstSprites.forEach((sprite, index) => {
                sprite.visible = burstVisibility[index] ?? false;
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Animation Loop
    // ─────────────────────────────────────────────────────────────────────────

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            // Schedule the next frame up-front so the loop self-heals and resumes automatically
            // after any throttled/skipped frames (matches BaseTheme.safeAnimate semantics).
            this.animationFrameId = requestAnimationFrame(animate);
            this.registerAnimation(this.animationFrameId);

            // Honor engine-wide background-tab / pause throttling that every other theme respects via
            // safeAnimate(). When the window is hidden the engine sets isRenderingPaused (skip entirely)
            // or isRenderingReduced (render at ~10 FPS). Skipping here stops this heavy scene from
            // burning GPU in the background; visible-frame output is unchanged.
            if (!this.shouldRenderFrame()) return;

            // Clamp delta so a long stall (alt-tab resume, GC hitch, throttled frame) can't teleport
            // particles/drift in a single huge step. Normal frames are far below this cap, so steady-state
            // motion is identical.
            const delta = this.fixedDeltaSeconds ?? Math.min(0.25, this.clock.getDelta());
            this.time += delta;
            this.updateDynamicResolution(delta);
            this.processGameplayFx(delta);
            // updateGpuTimings is async and resolves the compute-timestamp pool at ~2 Hz. Invoking
            // it every frame allocated a throwaway Promise + microtask even on the frames it bailed
            // at its own 500 ms check. Gate that cadence here, synchronously, so the async call only
            // happens when there is actually a pool to drain.
            if (this.gpuTimings.enabled
                && performance.now() - this.gpuTimings.lastResolve >= 500) {
                this.updateGpuTimings();
            }

            // Smooth intensity transitions
            this.diskIntensity += (this.diskTargetIntensity - this.diskIntensity)
                * (1 - Math.exp(-6.3 * delta));
            this.coreIntensity += (this.coreTargetIntensity - this.coreIntensity)
                * (1 - Math.exp(-9.7 * delta));
            this.diskRotationSpeed += (this.diskTargetRotationSpeed - this.diskRotationSpeed)
                * (1 - Math.exp(-3.1 * delta));
            this.hawkingIntensity += (this.hawkingTargetIntensity - this.hawkingIntensity)
                * (1 - Math.exp(-5.0 * delta));

            // Decay flash effects
            if (this.starFlashIntensity > 0) {
                this.starFlashIntensity *= Math.exp(-5.0 * delta);
                if (this.starFlashIntensity < 0.01) this.starFlashIntensity = 0;
            }
            if (this.bloomPulseIntensity > 0) {
                this.bloomPulseIntensity *= Math.exp(-3.7 * delta);
                if (this.bloomPulseIntensity < 0.005) this.bloomPulseIntensity = 0;
            }
            if (this.chromaticPulse > 0.002) {
                this.chromaticPulse *= Math.exp(-3.1 * delta);
            }
            if (this.photonSpherePulse > 0) {
                this.photonSpherePulse *= Math.exp(-6.3 * delta);
                if (this.photonSpherePulse < 0.01) this.photonSpherePulse = 0;
            }
            if (this.particleEventBoost > 0) {
                this.particleEventBoost *= Math.exp(-7.7 * delta);
                if (this.particleEventBoost < 0.01) this.particleEventBoost = 0;
            }
            if (this.gravitySurgeFactor > 0) {
                this.gravitySurgeFactor *= Math.exp(-3.1 * delta);
                if (this.gravitySurgeFactor < 0.01) this.gravitySurgeFactor = 0;
            }
            if (this.burstFactor > 0) {
                this.burstFactor *= (this.qualityPreset.burstDecay ?? 0.94) ** (delta * 60);
                if (this.burstFactor < 0.01) {
                    this.burstFactor = 0;
                    this.burstPhase = false;
                }
            }
            if (this.diskTargetIntensity > 1.0) {
                this.diskTargetIntensity += (1.0 - this.diskTargetIntensity)
                    * (1 - Math.exp(-1.2 * delta));
                if (this.diskTargetIntensity < 1.01) this.diskTargetIntensity = 1.0;
            }
            if (this.coreTargetIntensity > 1.0) {
                this.coreTargetIntensity += (1.0 - this.coreTargetIntensity)
                    * (1 - Math.exp(-1.83 * delta));
                if (this.coreTargetIntensity < 1.01) this.coreTargetIntensity = 1.0;
            }
            if (this.diskTargetRotationSpeed > 1.0) {
                this.diskTargetRotationSpeed += (1.0 - this.diskTargetRotationSpeed)
                    * (1 - Math.exp(-1.52 * delta));
                if (this.diskTargetRotationSpeed < 1.01) this.diskTargetRotationSpeed = 1.0;
            }
            if (this.hawkingTargetIntensity > 1.0) {
                this.hawkingTargetIntensity += (1.0 - this.hawkingTargetIntensity)
                    * (1 - Math.exp(-1.2 * delta));
                if (this.hawkingTargetIntensity < 1.01) this.hawkingTargetIntensity = 1.0;
            }
            this.diskDopplerBoost += (1.0 - this.diskDopplerBoost)
                * (1 - Math.exp(-1.4 * delta));

            // Update shaders
            this.setCachedUniform('coreTime', this.time);
            this.setCachedUniform('coreIntensity', this.coreIntensity);

            this.setCachedUniform('diskTime', this.time);
            this.setCachedUniform('diskIntensity', this.diskIntensity);
            this.setCachedUniform('diskRotation', this.diskRotationSpeed);

            this.setCachedUniform('innerDiskTime', this.time * 1.3);
            this.setCachedUniform('innerDiskIntensity', this.diskIntensity * 1.2);
            this.setCachedUniform('innerDiskRotation', this.diskRotationSpeed * 1.5);

            for (let index = 0; index < this.accretionVolumeLayers.length; index += 1) {
                const layer = this.accretionVolumeLayers[index];
                const boost = 0.2 + index * 0.1;
                this.setMaterialUniform(layer?.material, 'uTime', this.time * 0.8);
                this.setMaterialUniform(layer?.material, 'uIntensity', this.diskIntensity * boost);
                this.setMaterialUniform(layer?.material, 'uRotationSpeed', this.diskRotationSpeed * 0.6);
            }

            this.setCachedUniform('hawkingTime', this.time);
            this.setCachedUniform('hawkingIntensity', this.hawkingIntensity);
            this.setCachedUniform('photonTime', this.time);
            const ringEnergy = Math.max(
                this.fxSignals.ringPulse || 0,
                (this.fxSignals.shearDoppler || 0) * 0.45,
                (this.fxSignals.stellarArc || 0) * 0.7,
                this.fxSignals.caustic || 0,
            );
            const shearEnergy = Math.max(
                this.fxSignals.shearDoppler || 0,
                (this.fxSignals.stellarArc || 0) * 0.7,
                this.fxSignals.caustic || 0,
            );
            const arcEnergy = Math.max(
                this.fxSignals.stellarArc || 0,
                this.fxSignals.caustic || 0,
            );
            const causticEnergy = this.fxSignals.caustic || 0;
            this.setCachedUniform(
                'photonIntensity',
                0.58 + Math.max(0, this.coreIntensity - 1) * 0.08 + this.photonSpherePulse * 0.16,
            );
            this.setMaterialUniform(this.photonSphere?.material, 'uEchoStrength', 0.075 + ringEnergy * 0.14);
            this.setMaterialUniform(this.photonSphere?.material, 'uCausticStrength', causticEnergy * 0.82);
            this.setMaterialUniform(this.accretionDisk?.material, 'uDopplerBoost', Math.min(
                1.62,
                0.92 + shearEnergy * 0.52 + Math.max(0, this.diskDopplerBoost - 1) * 0.08,
            ));
            this.setMaterialUniform(this.accretionDisk?.material, 'uEventEnergy', this.comboVisualEnergy);
            this.setMaterialUniform(this.accretionDisk?.material, 'uCausticStrength', causticEnergy * 0.72);
            this.setMaterialUniform(this.lensedDiskArc?.material, 'uTime', this.time);
            this.setMaterialUniform(this.lensedDiskArc?.material, 'uIntensity', 0.45 + arcEnergy * 0.24);
            this.setMaterialUniform(this.lensedDiskArc?.material, 'uDopplerBoost', 0.9 + shearEnergy * 0.45);
            this.setMaterialUniform(this.lensedDiskArc?.material, 'uCausticStrength', causticEnergy * 0.78);
            this.setMaterialUniform(this.polarJet?.material, 'uTime', this.time);
            this.setMaterialUniform(
                this.polarJet?.material,
                'uIntensity',
                Math.max(0, arcEnergy * 0.3 - 0.08),
            );
            this.setMaterialUniform(this.lockRipple?.material, 'uProgress', this.fxSignals.lockRippleProgress || 0);
            this.setMaterialUniform(this.lockRipple?.material, 'uIntensity', this.fxSignals.lockRipple || 0);
            this.setMaterialUniform(this.lockRipple?.material, 'uCompression', this.fxSignals.lockCompression || 0);
            this.setMaterialUniform(this.matterStream?.material, 'uProgress', this.fxSignals.matterStreamProgress || 0);
            this.setMaterialUniform(this.matterStream?.material, 'uIntensity', this.fxSignals.matterStream || 0);

            // Update burst sparks (fallback pool path only)
            if (!this.burstComputeBanks.length) {
                this.burstSparksPool.forEach((burstSparks) => {
                    const material = burstSparks?.material;
                    if (!material) return;

                    this.setMaterialUniform(material, 'uTime', this.time);

                    const pulseTimer = this.getMaterialUniform(material, 'uPulseTimer');
                    if (pulseTimer !== undefined && pulseTimer > -50.0) {
                        const nextPulse = pulseTimer + delta;
                        const complete = nextPulse > 1.6;
                        this.setMaterialUniform(material, 'uPulseTimer', complete ? -100.0 : nextPulse);
                        burstSparks.visible = !complete;
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
                        const isIdle = pulseTimer === undefined || pulseTimer <= -50.0 || pulseTimer > 1.6;

                        if (isIdle) {
                            this.setMaterialUniformVec3(
                                burstSparks?.material,
                                'uBlackHolePos',
                                burstOrigin.x,
                                burstOrigin.y,
                                burstOrigin.z,
                            );
                            this.setMaterialUniform(burstSparks?.material, 'uPulseTimer', 0.0);
                            burstSparks.visible = true;
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
            const drift = this.computeDriftPosition(this.time, this._driftScratch);
            this.driftX = drift.x;
            this.driftY = drift.y;
            this.driftZ = drift.z;
            this.applyBlackHoleDriftState();
            if (this.fxSignals.activeLockCount > 0) this.updateMatterStreamPlacement();
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

            // Update burst sparks compute after drift update.
            // Reconcile each bank's RENDER visibility every frame: an empty bank is set
            // invisible so the renderer skips its draw entirely — burst render cost now
            // follows active particles, not allocated capacity. The visibility test is a
            // cheap CPU timestamp compare; the expensive GPU compute dispatch stays gated
            // behind shouldRunBurstCompute(). Because shouldRunBurstCompute() itself returns
            // true whenever any bank hasActiveParticles, a false result guarantees every bank
            // is idle, so hiding them all is correct.
            if (this.burstComputeBanks.length) {
                const runBurstCompute = this.shouldRunBurstCompute();
                const blackHolePos = runBurstCompute
                    ? this.computeBlackHolePos.set(this.driftX || 0, this.driftY || 0, this.driftZ || 0)
                    : null;
                for (let i = 0; i < this.burstComputeBanks.length; i += 1) {
                    const burstCompute = this.burstComputeBanks[i];
                    const sparks = this.burstSparkBanks[i];
                    const active = !!burstCompute?.computeNode
                        && (burstCompute.hasActiveParticles?.(this.time) ?? false);
                    if (sparks && sparks.visible !== active) sparks.visible = active;
                    if (!active || !runBurstCompute) continue;
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
            for (let i = 0; i < this.nebulaClouds.length; i += 1) {
                this.nebulaClouds[i].rotation.z += delta * 0.006;
            }

            this.updateNaturalCamera(delta);

            // Project the moving singularity once; the post lens works in UV
            // space and remains aligned on both backends.
            this.projectedLensCenter
                .set(this.driftX || 0, this.driftY || 0, this.driftZ || 0)
                .project(this.camera);
            this._lensCenterScratch[0] = this.projectedLensCenter.x * 0.5 + 0.5;
            this._lensCenterScratch[1] = this.projectedLensCenter.y * 0.5 + 0.5;
            if (this.postProcessing) {
                // Only the four dynamic fields change per frame; the rest (chromaticStrength,
                // lensCenter ref, exposure, saturation, tint, dither) were set once in the ctor.
                const postParams = this._postUpdateParams;
                postParams.bloomStrength = this.qualityPreset.bloomStrength
                    * (1 + this.bloomPulseIntensity * 0.6 + this.comboVisualEnergy * 0.2);
                postParams.bloomRadius = this.qualityPreset.bloomRadius;
                postParams.bloomDownsample = this.getAdaptiveBloomDownsample();
                postParams.lensStrength = 0.016
                    + this.comboVisualEnergy * 0.018
                    + (this.fxSignals.lockCompression || 0) * 0.01;
                this.postProcessing.update(postParams);
            }

            // Render
            this.renderer.clear();
            if (this.postProcessing && this.flags.usePost) {
                this.postProcessing.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            // Sample this frame's measured GPU render cost so the next dynamic-resolution
            // step can steer on actual rendering work instead of presentation delta. Cheap
            // and overlap-guarded; no-op when timestamp queries are unsupported.
            this.sampleRenderGpuTiming();
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

        // The GPU-compute particle path is dormant on this build (no preset sets
        // enableBurstCompute), so this analytic integration is the LIVE ambient sim — a
        // per-frame main-thread loop over up to `particleCount` dust motes plus a full
        // position+lifetime attribute upload. Earlier GPU-visibility profiling missed this
        // cost because it toggled `.visible`, not the update. Cap it at 60 Hz and fold the
        // skipped display frames into one bounded, integrated timestep. The integrator is
        // already stepScale-correct (damping uses `** stepScale`; forces scale by dt), so a
        // larger dt lands the motes in the same places — visually identical for slow background
        // dust. 60 Hz was chosen as the cap because it matches the most common panel refresh
        // and stays at every-frame on a 60 Hz display (zero behaviour change there), while
        // removing up to ~3/4 of this work on a 120/240 Hz panel. The accumulator also folds in
        // any time banked by the post-combo suspension window above, matching the compute path.
        const CPU_PARTICLE_INTERVAL = 1 / 60;
        this.performanceState.particleComputeAccumulator += delta;
        if (this.performanceState.particleComputeAccumulator < CPU_PARTICLE_INTERVAL) return;
        const simDelta = Math.min(0.075, this.performanceState.particleComputeAccumulator);
        this.performanceState.particleComputeAccumulator = 0;

        const positions = this.particleAttributes.position.array;
        const velocities = this.particleVelocities;
        const lifetimes = this.particleLifetimes;

        const comboScatterWindowActive = this.time <= this.comboScatterHoldUntil;
        const normalY = this.diskSinTilt;
        const normalZ = this.diskCosTilt;
        const stepScale = simDelta * 60.0;
        const planePullScale = simDelta * 60.0;
        const planeDamp = Math.min(0.35, simDelta * 5.0);

        const activeCount = Math.min(
            lifetimes.length,
            this.particles?.count ?? lifetimes.length,
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
                    const burstStrength = effectiveBurstFactor * (400.0 / (dist + 50)) * simDelta;

                    velocities[i3] += nx * burstStrength;
                    velocities[i3 + 1] += ny * burstStrength;
                    velocities[i3 + 2] += nz * burstStrength;

                    // Less drag during burst to let particles fly out
                    const burstDamping = 0.998 ** stepScale;
                    velocities[i3] *= burstDamping;
                    velocities[i3 + 1] *= burstDamping;
                    velocities[i3 + 2] *= burstDamping;

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
                    let pullStrength = (800.0 / (distSq + 100)) * simDelta;
                    if (comboLocked) {
                        // Preserve combo burst trails so they accumulate across close combos.
                        pullStrength *= 0.08;
                    }

                    // STRONG suction during combos, eased smoothly back to normal on the way out.
                    // The boost keeps its full impact strength at high surge (equals the old
                    // 5 + surge*2 once surge >= 4) but eases CONTINUOUSLY down to 1.0 as the surge
                    // fades, instead of holding ~5x and then snapping to 1x — so the post-combo pull
                    // settles smoothly rather than cutting out. Mirrors the GPU kernel exactly.
                    if (this.gravitySurgeFactor > 0) {
                        const surge = this.gravitySurgeFactor;
                        const t = Math.max(0, Math.min(1, surge * 0.25)); // smoothstep(0, 4, surge)
                        const surgeEase = t * t * (3.0 - 2.0 * t);
                        pullStrength *= (1.0 + surge * 2.0 + surgeEase * 4.0);
                    }

                    velocities[i3] -= px * pullStrength;
                    velocities[i3 + 1] -= py * pullStrength;
                    velocities[i3 + 2] -= pz * pullStrength;

                    // Tangential acceleration REMOVED - rely on natural gravity + drag for organic spiral
                    // This prevents the "off" feeling of forced planar motion

                    // Combined damping (0.995 * 0.99 = 0.98505) - one multiply per axis instead of two.
                    const orbitalDamping = 0.98505 ** stepScale;
                    velocities[i3] *= orbitalDamping;
                    velocities[i3 + 1] *= orbitalDamping;
                    velocities[i3 + 2] *= orbitalDamping;

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
                    velocities[i3] += tX * orbitalAssist * stepScale;
                    velocities[i3 + 1] += tY * orbitalAssist * stepScale;
                    velocities[i3 + 2] += tZ * orbitalAssist * stepScale;
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
            positions[i3] += velocities[i3] * stepScale;
            positions[i3 + 1] += velocities[i3 + 1] * stepScale;
            positions[i3 + 2] += velocities[i3 + 2] * stepScale;

            // Smoothly relax reset distance during bursts so chained combos don't pop particles back.
            const maxDist = comboScatterActive ? (4200 + burstBlend * 800) : (950 + burstBlend * 750);
            const minResetDist = comboScatterActive ? 30 : 80;
            const nextDistSq = positions[i3] * positions[i3]
                + positions[i3 + 1] * positions[i3 + 1]
                + positions[i3 + 2] * positions[i3 + 2];
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
                lifetimes[i] += simDelta * 0.5;
                if (lifetimes[i] > 1.0) lifetimes[i] = 1.0;
            }
        }

        this.particleAttributes.position.needsUpdate = true;
        this.particleAttributes.lifetime.needsUpdate = true;

        this.setMaterialUniformVec3(
            this.particles?.material,
            'uBlackHolePos',
            this.driftX || 0,
            this.driftY || 0,
            this.driftZ || 0,
        );
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
        // Invalidate timestamp work before any renderer/backend can be disposed. In-flight
        // promises are generation-fenced above; clearing these flags also makes stop()
        // immediately quiescent from the animation loop's point of view.
        if (this.gpuTimings) {
            this.gpuTimings.enabled = false;
            this.gpuTimings.renderPending = false;
        }
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

        this.postProcessing?.dispose?.();
        this.postProcessing = null;
        this.particleCompute?.dispose?.();
        this.particleCompute = null;
        this.disposeBurstComputeBanks();
        this.starLensingCompute?.dispose?.();
        this.starLensingCompute = null;
        this.fxController.dispose();

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
            // We enabled timestamp tracking for GPU-timed DRS; turn it back off before
            // teardown so nothing lingers on the backend if it is ever pooled/reused.
            if (this.renderer.backend) this.renderer.backend.trackTimestamp = false;
            this.removeRendererResilience();
            this.disposeRenderer(this.renderer, { nullInstance: false });
        }

        this.renderer = null;
        this.scene = null;
        this.camera = null;
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
        this.lensedDiskArc = null;
        this.lockRipple = null;
        this.matterStream = null;
        this.polarJet = null;
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
