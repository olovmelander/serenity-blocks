/* eslint-disable import/no-extraneous-dependencies, import/no-unresolved */
/**
 * Ocean Depths Theme - Immersive Stylized Underwater World
 *
 * Premium underwater experience with:
 * - Smooth curved seaweed/kelp with proper geometry
 * - Circular soft particles (not squared)
 * - Detailed coral reef formations
 * - Realistic fish school behavior
 * - Smooth underwater rendering with volumetric effects
 * - Gentle camera sway for immersion
 *
 * WebGPU + TSL pipeline (graceful WebGL2 fallback)
 */

import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { mrt, vec3 } from 'three/tsl';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { OCEAN_TETROMINOS } from './ocean-tetrominos.js';
import { OceanAtmosphereSystem } from './ocean-atmosphere-system.js';
import { OceanFishSystem } from './ocean-fish-system.js';
import { OceanRareFaunaSystem } from './ocean-rare-fauna-system.js';
import { OceanReefDwellerSystem } from './ocean-reef-dweller-system.js';
import {
    OCEAN_FAUNA_ASSET_VERSION,
    summarizeFaunaAssetManifest,
} from './ocean-fauna-assets.js';
import { OceanGameplayEffects, QUALITY_EFFECT_LIMITS } from './ocean-gameplay-effects.js';
import { OceanPost, OceanPostProcessingLegacy } from './ocean-post.js';
import { OceanCamera } from './ocean-camera.js';
import {
    createWaterSurfaceNodeMaterial,
    createSeabedNodeMaterial,
    createSeaweedNodeMaterial,
    createSeagrassMeadowNodeMaterial,
    createCoralNodeMaterial,
    createJellyfishNodeMaterial,
    createPlanktonNodeMaterial,
    createBubbleNodeMaterial,
} from './ocean-materials.js';

function randRangeLocal(min, max) {
    return min + Math.random() * (max - min);
}

function readOceanBooleanParam(key) {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(key)) return false;
    const value = params.get(key);
    if (value === '' || value === null) return true;
    const normalized = value.toLowerCase();
    return (
        normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
    );
}

// Reads a boolean URL flag under either an ocean-prefixed key or a short alias,
// e.g. readOceanFlag('oceanNoFish', 'noFish'). Matches swedish-forest convention.
function readOceanFlag(longKey, shortKey) {
    return readOceanBooleanParam(longKey) || (shortKey ? readOceanBooleanParam(shortKey) : false);
}

// Catalogue of every ocean debug flag. Used by the constructor to populate
// this.flags and by the console banner. Keeping the list in one place means a
// new flag only needs a single entry here plus the gate where it's consumed.
const OCEAN_DEBUG_FLAGS = [
    // Scene subsystems (skip create + skip update)
    ['noFish', 'oceanNoFish'],
    ['noHeroAssets', 'oceanNoHeroAssets'],
    ['noDwellers', 'oceanNoDwellers'],
    ['noRareFauna', 'oceanNoRareFauna'],
    ['noSeaweed', 'oceanNoSeaweed'],
    ['noSeagrass', 'oceanNoSeagrass'],
    ['noCoral', 'oceanNoCoral'],
    ['noJellyfish', 'oceanNoJellyfish'],
    ['noPlankton', 'oceanNoPlankton'],
    ['noBubbles', 'oceanNoBubbles'],
    ['noBillboards', 'oceanNoBillboards'],
    ['noAtmosphere', 'oceanNoAtmosphere'],
    ['noAtmosphereBillboards', 'oceanNoAtmosphereBillboards'],
    // Granular atmosphere components (Phase 1 diagnostic flags). Each toggles
    // one piece of OceanAtmosphereSystem so we can A/B which one drives the
    // ~16 ms `ocean.post` cost increase that disappears with ?oceanNoAtmosphere.
    ['noHaze', 'oceanNoHaze'],
    ['noBeamDust', 'oceanNoBeamDust'],
    ['noGlowAnchors', 'oceanNoGlowAnchors'],
    ['noBioSilhouettes', 'oceanNoBioSilhouettes'],
    ['noHeroCoral', 'oceanNoHeroCoral'],
    ['noHeroKelp', 'oceanNoHeroKelp'],
    ['noHeroReef', 'oceanNoHeroReef'],
    ['noCoralCarpets', 'oceanNoCoralCarpets'],
    ['noForegroundRocks', 'oceanNoForegroundRocks'],
    ['noImportedSeabed', 'oceanNoImportedSeabed'],
    ['noReefSilhouettes', 'oceanNoReefSilhouettes'],
    ['noArches', 'oceanNoArches'],
    ['noGameplayFx', 'oceanNoGameplayFx'],
    ['noSeabed', 'oceanNoSeabed'],
    ['noWater', 'oceanNoWater'],
    // Post-processing
    ['noPost', 'oceanNoPost'],
    ['noGodRays', 'oceanNoGodRays'],
    ['noDof', 'oceanNoDof'],
    ['noRefraction', 'oceanNoRefraction'],
    ['noChroma', 'oceanNoChroma'],
    ['noBloom', 'oceanNoBloom'],
    ['noGrade', 'oceanNoGrade'],
    ['noVignette', 'oceanNoVignette'],
    // Control flags
    ['noStriding', 'oceanNoStriding'],
    ['logStartup', 'oceanLogStartup'],
    ['help', 'oceanHelp'],
    // Phase D.3: auto-bisection mode. When set, after warmup the theme cycles
    // through major subsystem disables for 6 s each, recording p50 FPS per
    // config, then console.tables a sorted delta-vs-baseline report.
    ['bisect', 'oceanBisect'],
];

function roundMetric(value, decimals = 2) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** decimals;
    return Math.round(value * scale) / scale;
}

const OCEAN_ART_DIRECTION = {
    mode: 'showcase-reef-canyon',
    assetStrategy: 'poly-pizza-hero-reef-procedural-volume',
    heroAssetSourcePolicy: 'CC0-preferred-CC-BY-with-attribution',
    palette: 'cyan-water-violet-coral-orange-sponge',
    tonalBalance: 'bright-shallow-canyon-saturated-midground',
    proprietaryAssets: false,
};

const OCEAN_READABILITY_ZONE = {
    halfWidth: 28,
    zMin: -42,
    zMax: 70,
};

const OCEAN_REEF_GARDENS = [
    {
        x: -58, z: 48, radius: 24, warmth: 0.95,
    },
    {
        x: 62, z: 42, radius: 26, warmth: 1.0,
    },
    {
        x: -82, z: -42, radius: 34, warmth: 0.72,
    },
    {
        x: 88, z: -56, radius: 36, warmth: 0.78,
    },
    {
        x: -118, z: -112, radius: 44, warmth: 0.48,
    },
    {
        x: 120, z: -118, radius: 44, warmth: 0.5,
    },
];

function sampleReefGardenPoint(spread = 140, radiusScale = 1) {
    const garden = OCEAN_REEF_GARDENS[Math.floor(Math.random() * OCEAN_REEF_GARDENS.length)];
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * garden.radius * radiusScale;
    return {
        garden,
        x: Math.max(-spread, Math.min(spread, garden.x + Math.cos(angle) * radius)),
        z: Math.max(-150, Math.min(92, garden.z + Math.sin(angle) * radius)),
    };
}

function chooseSeaweedBladeType(roll) {
    if (roll < 0.46) return 0;
    if (roll < 0.84) return 1;
    return 2;
}

// Hero kelp grove anchors. The Abzu / Subnautica look depends on tall ribbon
// kelp being CLUSTERED rather than scattered uniformly — pockets of grove form
// dramatic silhouettes against god rays. Placed in mid-distance bands flanking
// the camera so they catch the sun shafts but never block the readability column.
const OCEAN_KELP_GROVES = [
    { x: -48, z: 18, radius: 14 },
    { x: 54, z: 22, radius: 16 },
    { x: -86, z: -38, radius: 22 },
    { x: 96, z: -28, radius: 22 },
];

function sampleKelpGrovePoint() {
    const grove = OCEAN_KELP_GROVES[Math.floor(Math.random() * OCEAN_KELP_GROVES.length)];
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * grove.radius;
    return {
        x: grove.x + Math.cos(angle) * radius,
        z: grove.z + Math.sin(angle) * radius,
    };
}

export default class OceanTheme extends BaseTheme {
    constructor() {
        super('ocean');
        this.eventUnsubscribers = [];
        this.animationFrameId = null;
        this.clock = new THREE.Clock();

        // Backend flag
        this.isWebGPU = false;
        this.flags = {
            forceWebGL: readOceanBooleanParam('forceWebGL') || readOceanBooleanParam('oceanForceWebGL'),
        };
        // Debug flags — see OCEAN_DEBUG_FLAGS. Each accepts short (?noX=1) and
        // long (?oceanNoX=1) aliases. Used to isolate per-subsystem cost so we
        // can identify what's actually slow rather than guessing.
        OCEAN_DEBUG_FLAGS.forEach(([shortKey, longKey]) => {
            this.flags[shortKey] = readOceanFlag(longKey, shortKey);
        });
        this._emitDebugBanner();
        this.webglFallbackClamped = false;
        this.webglFallbackClampedFromQuality = null;

        // Camera state machine
        this.oceanCamera = null;

        // Three.js components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.waterSurface = null;
        this.seabed = null;
        this.seaweedInstances = null;
        this.seagrassMeadowInstances = null;
        this.coralGroup = null;
        this.atmosphereSystem = null;
        this.fishSystem = null;
        this.rareFaunaSystem = null;
        this.gameplayEffects = null;
        this.jellyfishMesh = null;
        this.jellyfishData = null;
        this.planktonMesh = null;
        this.planktonData = null;
        this.bubbleMesh = null;
        this.bubbleBillboardData = null;
        this.bubbleData = null;
        this.oceanPost = null;
        this.godRays = null;
        this._tslUniforms = null;
        this._oceanMrtWarned = false;
        this.billboardDummy = new THREE.Object3D();

        // Animation state
        this.currentStrength = 0.5;
        this.targetCurrentStrength = 0.5;
        this.glowIntensity = 0.65;
        this.targetGlowIntensity = 0.65;

        // Frame striding: alternate-frame updates for non-critical subsystems.
        // Heavy work (matrix uploads, behavior switches) runs at 30 Hz; uniform
        // updates and gameplay-critical motion stay at 60 Hz. Even/odd stride
        // groups offset cost between frames so neither frame doubles up.
        this.frameCount = 0;
        this._strideDtAccum = { evenHeavy: 0, oddHeavy: 0 };

        // Uniform update cache
        this.uniformsToUpdate = [];
        this.signoffFrameTimes = [];
        this.signoffMaxFrameSamples = 420;
        this.signoffHelper = null;
        this.habitatMetrics = null;

        // Quality presets — AAA upgrade (matches plan table)
        this.currentQuality = 'High';
        this.qualityPresets = {
            Minimal: {
                seaweedCount: 800,
                seagrassCount: 0,
                rippleNormalStrength: 0.0,
                causticStrength: 0.40,
                coralCount: 10,
                reefDwellerCount: 0,
                fishCount: 60,
                heroFishCount: 0,
                jellyfishCount: 6,
                planktonCount: 120,
                bubbleCount: 80,
                terrainSegments: 80,
                godRaySamples: 0,
                shaftStrength: 0,
                refractionEnabled: false,
                dofEnabled: false,
                chromaticEdge: 0,
                useGPUCompute: false,
                atmosphere: {
                    rayCount: 3,
                    rayStrength: 0.62,
                    hazeLayers: 1,
                    hazeStrength: 0.35,
                    reefCount: 4,
                    archCount: 0,
                    glowAnchors: 0,
                    beamDustCount: 36,
                    occluderCount: 0,
                    biomeSilhouetteCount: 0,
                    foregroundRockCount: 0,
                    reefWallCount: 0,
                    coralCarpetPatchCount: 0,
                    importedSeabedDetailCount: 0,
                    tubeCoralClusterCount: 0,
                    plateCoralShelfCount: 0,
                    heroCoralCount: 0,
                    heroKelpCount: 0,
                },
                rareFauna: {
                    enabled: false,
                    maxActive: 0,
                    firstSpawnDelay: 90,
                    turtleCooldown: [9999, 9999],
                    sharkCooldown: [9999, 9999],
                    whaleCooldown: [9999, 9999],
                    mantaRayCooldown: [9999, 9999],
                    dolphinCooldown: [9999, 9999],
                },
                postProcessing: { grade: false, bloom: false, postProcessingEnabled: false },
            },
            Low: {
                seaweedCount: 1500,
                seagrassCount: 420,
                rippleNormalStrength: 1.0,
                causticStrength: 0.55,
                coralCount: 18,
                reefDwellerCount: 12,
                fishCount: 120,
                heroFishCount: 0,
                jellyfishCount: 10,
                planktonCount: 220,
                bubbleCount: 120,
                terrainSegments: 100,
                godRaySamples: 0,
                shaftStrength: 0.7,
                refractionEnabled: false,
                dofEnabled: false,
                chromaticEdge: 0.0004,
                useGPUCompute: true,
                atmosphere: {
                    rayCount: 5,
                    rayStrength: 0.78,
                    hazeLayers: 2,
                    hazeStrength: 0.32,
                    reefCount: 7,
                    archCount: 1,
                    glowAnchors: 3,
                    beamDustCount: 90,
                    occluderCount: 0,
                    biomeSilhouetteCount: 2,
                    foregroundRockCount: 3,
                    coralOvergrowthPerRock: 1,
                    reefWallCount: 2,
                    coralCarpetPatchCount: 1,
                    importedSeabedDetailCount: 6,
                    tubeCoralClusterCount: 1,
                    plateCoralShelfCount: 1,
                    heroCoralCount: 2,
                    heroKelpCount: 2,
                },
                rareFauna: {
                    enabled: false,
                    maxActive: 0,
                    firstSpawnDelay: 90,
                    turtleCooldown: [9999, 9999],
                    sharkCooldown: [9999, 9999],
                    whaleCooldown: [9999, 9999],
                    mantaRayCooldown: [9999, 9999],
                    dolphinCooldown: [9999, 9999],
                },
                postProcessing: { grade: false, bloom: false, postProcessingEnabled: true },
            },
            Medium: {
                seaweedCount: 2500,
                seagrassCount: 1000,
                rippleNormalStrength: 1.6,
                causticStrength: 0.75,
                coralCount: 28,
                reefDwellerCount: 28,
                fishCount: 220,
                heroFishCount: 7,
                jellyfishCount: 16,
                planktonCount: 380,
                bubbleCount: 200,
                terrainSegments: 120,
                godRaySamples: 0,
                shaftStrength: 0.85,
                refractionEnabled: false,
                dofEnabled: false,
                chromaticEdge: 0.0006,
                useGPUCompute: true,
                atmosphere: {
                    rayCount: 10,
                    rayStrength: 1.0,
                    hazeLayers: 4,
                    hazeStrength: 0.32,
                    reefCount: 12,
                    archCount: 2,
                    glowAnchors: 7,
                    beamDustCount: 160,
                    occluderCount: 0,
                    biomeSilhouetteCount: 3,
                    foregroundRockCount: 4,
                    coralOvergrowthPerRock: 2,
                    reefWallCount: 3,
                    coralCarpetPatchCount: 2,
                    importedSeabedDetailCount: 10,
                    tubeCoralClusterCount: 2,
                    plateCoralShelfCount: 2,
                    heroCoralCount: 4,
                    heroKelpCount: 4,
                },
                rareFauna: {
                    enabled: false,
                    maxActive: 0,
                    firstSpawnDelay: 90,
                    turtleCooldown: [9999, 9999],
                    sharkCooldown: [9999, 9999],
                    whaleCooldown: [9999, 9999],
                    mantaRayCooldown: [9999, 9999],
                    dolphinCooldown: [9999, 9999],
                },
                postProcessing: {
                    grade: true,
                    bloom: true,
                    bloomStrength: 0.075,
                    bloomThreshold: 0.88,
                    bloomRadius: 0.36,
                    gradeStrength: 0.58,
                    vignette: 0.24,
                    blackLift: 0.035,
                    postProcessingEnabled: true,
                },
            },
            High: {
                seaweedCount: 4000,
                seagrassCount: 1700,
                rippleNormalStrength: 2.2,
                causticStrength: 0.95,
                coralCount: 42,
                reefDwellerCount: 72,
                fishCount: 320,
                heroFishCount: 7,
                jellyfishCount: 24,
                planktonCount: 560,
                bubbleCount: 280,
                terrainSegments: 150,
                godRaySamples: 0,
                shaftStrength: 0.85,
                refractionEnabled: true,
                dofEnabled: false,
                chromaticEdge: 0.0008,
                useGPUCompute: true,
                atmosphere: {
                    rayCount: 8,
                    rayStrength: 0.65,
                    hazeLayers: 3,
                    hazeStrength: 0.22,
                    reefCount: 8,
                    archCount: 4,
                    glowAnchors: 11,
                    beamDustCount: 240,
                    occluderCount: 0,
                    biomeSilhouetteCount: 4,
                    foregroundRockCount: 8,
                    coralOvergrowthPerRock: 2,
                    reefWallCount: 4,
                    coralCarpetPatchCount: 6,
                    importedSeabedDetailCount: 16,
                    tubeCoralClusterCount: 2,
                    plateCoralShelfCount: 2,
                    heroCoralCount: 6,
                    heroKelpCount: 5,
                },
                rareFauna: {
                    enabled: true,
                    maxActive: 1,
                    firstSpawnDelay: 90,
                    turtleCooldown: [240, 420],
                    sharkCooldown: [480, 780],
                    whaleCooldown: [540, 900],
                    mantaRayCooldown: [360, 600],
                    dolphinCooldown: [300, 540],
                },
                postProcessing: {
                    grade: true,
                    bloom: true,
                    bloomStrength: 0.085,
                    bloomThreshold: 0.88,
                    bloomRadius: 0.36,
                    gradeStrength: 0.66,
                    vignette: 0.26,
                    blackLift: 0.04,
                    postProcessingEnabled: true,
                },
            },
            Ultra: {
                seaweedCount: 6500,
                seagrassCount: 2700,
                rippleNormalStrength: 2.6,
                causticStrength: 1.10,
                coralCount: 65,
                reefDwellerCount: 108,
                fishCount: 480,
                heroFishCount: 10,
                jellyfishCount: 38,
                planktonCount: 820,
                bubbleCount: 400,
                terrainSegments: 180,
                godRaySamples: 0,
                shaftStrength: 0.95,
                refractionEnabled: true,
                dofEnabled: false,
                chromaticEdge: 0.001,
                useGPUCompute: true,
                atmosphere: {
                    rayCount: 12,
                    rayStrength: 0.72,
                    hazeLayers: 4,
                    hazeStrength: 0.25,
                    causticStrength: 0.75,
                    reefCount: 9,
                    archCount: 6,
                    glowAnchors: 12,
                    glowAnchorOpacityScale: 0.92,
                    glowAnchorEmissiveScale: 0.45,
                    beamDustCount: 340,
                    occluderCount: 0,
                    biomeSilhouetteCount: 4,
                    foregroundRockCount: 12,
                    coralOvergrowthPerRock: 6,
                    reefWallCount: 6,
                    coralCarpetPatchCount: 24,
                    importedSeabedDetailCount: 12,
                    tubeCoralClusterCount: 3,
                    plateCoralShelfCount: 3,
                    heroCoralCount: 18,
                    heroKelpCount: 10,
                },
                rareFauna: {
                    enabled: true,
                    maxActive: 1,
                    firstSpawnDelay: 90,
                    turtleCooldown: [150, 300],
                    sharkCooldown: [360, 600],
                    whaleCooldown: [420, 720],
                    mantaRayCooldown: [240, 480],
                    dolphinCooldown: [210, 420],
                },
                postProcessing: {
                    grade: true,
                    bloom: true,
                    bloomStrength: 0.1,
                    bloomThreshold: 0.87,
                    bloomRadius: 0.38,
                    bloomScale: 0.45,
                    sceneScale: 0.82,
                    gradeStrength: 0.72,
                    vignette: 0.27,
                    blackLift: 0.045,
                    postProcessingEnabled: true,
                },
            },
            Extreme: {
                // Phase H.1+H.2: bisect showed fauna costs +16 fps and
                // seaweed/seagrass +15 fps at Extreme. Trim Extreme counts
                // to recover that gap with imperceptible density change.
                seaweedCount: 7500,
                seagrassCount: 3000,
                rippleNormalStrength: 3.0,
                causticStrength: 1.25,
                coralCount: 110,
                reefDwellerCount: 150,
                fishCount: 540,
                heroFishCount: 14,
                jellyfishCount: 45,
                planktonCount: 800,
                bubbleCount: 360,
                terrainSegments: 220,
                godRaySamples: 8,
                shaftStrength: 0.95,
                refractionEnabled: true,
                dofEnabled: true,
                chromaticEdge: 0.0014,
                useGPUCompute: true,
                atmosphere: {
                    rayCount: 16,
                    rayStrength: 0.88,
                    hazeLayers: 5,
                    hazeStrength: 0.32,
                    reefCount: 8,
                    archCount: 8,
                    glowAnchors: 14,
                    glowAnchorOpacityScale: 0.9,
                    glowAnchorEmissiveScale: 0.38,
                    beamDustCount: 480,
                    occluderCount: 0,
                    biomeSilhouetteCount: 4,
                    foregroundRockCount: 12,
                    coralOvergrowthPerRock: 8,
                    reefWallCount: 8,
                    coralCarpetPatchCount: 30,
                    importedSeabedDetailCount: 12,
                    tubeCoralClusterCount: 4,
                    plateCoralShelfCount: 4,
                    heroCoralCount: 24,
                    heroKelpCount: 14,
                },
                rareFauna: {
                    enabled: true,
                    maxActive: 1,
                    firstSpawnDelay: 90,
                    turtleCooldown: [150, 300],
                    sharkCooldown: [360, 600],
                    whaleCooldown: [420, 720],
                    mantaRayCooldown: [240, 480],
                    dolphinCooldown: [210, 420],
                },
                postProcessing: {
                    grade: true,
                    bloom: true,
                    bloomStrength: 0.115,
                    bloomThreshold: 0.86,
                    bloomRadius: 0.4,
                    bloomScale: 0.4,
                    sceneScale: 0.78,
                    gradeStrength: 0.76,
                    vignette: 0.28,
                    blackLift: 0.05,
                    postProcessingEnabled: true,
                },
            },
        };

        this.activePreset = this.qualityPresets.High;
        this.qualityChangeHandler = null;
        this.resetHabitatMetrics();
    }

    // Prints the active debug flag set and (if ?oceanHelp=1) the full catalogue.
    // The active-flag line always prints when any flag is set so the user can
    // confirm at a glance which features the current URL has disabled.
    _emitDebugBanner() {
        if (typeof console === 'undefined') return;
        const active = OCEAN_DEBUG_FLAGS
            .map(([shortKey]) => shortKey)
            .filter((shortKey) => this.flags[shortKey]);
        if (active.length > 0) {
            console.log(`[Ocean] Debug flags active: ${active.join(', ')}`);
        }
        if (this.flags.help) {
            const all = OCEAN_DEBUG_FLAGS.map(([shortKey]) => shortKey).join(', ');
            console.log(`[Ocean] All debug flags: ${all}`);
            console.log('[Ocean] Each flag accepts ?oceanNoX=1 (long) or ?noX=1 (short).');
            console.log('[Ocean] Press F3 to toggle the perf overlay and see per-subsystem timings.');
        }
    }

    getTetrominoConfig() {
        return OCEAN_TETROMINOS;
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    getBackendLabel() {
        return this.isWebGPU ? 'WebGPU' : 'WebGL2';
    }

    resetHabitatMetrics() {
        this.habitatMetrics = {
            artDirection: OCEAN_ART_DIRECTION.mode,
            assetStrategy: OCEAN_ART_DIRECTION.assetStrategy,
            readabilityZone: { ...OCEAN_READABILITY_ZONE },
            seabed: {
                rippleBands: true,
                terraceSculpt: true,
                centerClearing: true,
                reefShelfTerraces: true,
                foregroundSandChannel: true,
                sanctuaryBowl: true,
            },
            seaweed: {
                instances: 0,
                readabilityAvoidance: true,
                kelpCurtainBias: true,
                heroKelpSourcePolicy: OCEAN_ART_DIRECTION.heroAssetSourcePolicy,
                variants: {
                    shortGrass: 0,
                    ribbonKelp: 0,
                    tallAccentBlades: 0,
                },
            },
            coral: {
                colonies: 0,
                heroSourcePolicy: OCEAN_ART_DIRECTION.heroAssetSourcePolicy,
                showcaseTerraces: 0,
                reefGardenClusters: OCEAN_REEF_GARDENS.length,
                brain: 0,
                branch: 0,
                tube: 0,
                fan: 0,
                plate: 0,
                anemone: 0,
                spire: 0,
                shell: 0,
                readabilityAvoidance: true,
                palette: 'coral-sanctuary',
            },
            fauna: {
                layeredShoals: true,
                heroFishReadableLane: true,
                rareFaunaDistantCameos: true,
            },
            atmosphere: {
                tonalBalance: OCEAN_ART_DIRECTION.tonalBalance,
                showcaseReefCanyon: true,
                blenderReefAnchors: true,
                coralCarpetPatches: true,
                restrainedBubbleColumns: true,
                reefAnchoredPlankton: true,
                depthAbsorption: true,
            },
        };
    }

    isGameplayReadabilityZone(x, z) {
        return (
            Math.abs(x) < OCEAN_READABILITY_ZONE.halfWidth
            && z >= OCEAN_READABILITY_ZONE.zMin
            && z <= OCEAN_READABILITY_ZONE.zMax
        );
    }

    nudgeOutOfReadabilityZone(x, z, spread = 150) {
        if (!this.isGameplayReadabilityZone(x, z)) return { x, z };
        const side = x < 0 ? -1 : 1;
        return {
            x: side * randRangeLocal(OCEAN_READABILITY_ZONE.halfWidth + 12, spread),
            z: z < 12 ? z - randRangeLocal(24, 54) : z + randRangeLocal(20, 48),
        };
    }

    trackSignoffFrame(deltaSeconds) {
        const frameMs = deltaSeconds * 1000;
        if (!Number.isFinite(frameMs) || frameMs <= 0) return;
        this.signoffFrameTimes.push(frameMs);
        if (this.signoffFrameTimes.length > this.signoffMaxFrameSamples) {
            this.signoffFrameTimes.shift();
        }
    }

    getSignoffPerformanceSnapshot() {
        const frames = this.signoffFrameTimes.filter(
            (frameMs) => Number.isFinite(frameMs) && frameMs > 0,
        );
        const renderInfo = this.renderer?.info?.render || null;
        if (!frames.length) {
            return {
                sampleCount: 0,
                averageFps: null,
                p95FrameMs: null,
                low1Fps: null,
                render: renderInfo
                    ? {
                        calls: renderInfo.calls || 0,
                        triangles: renderInfo.triangles || 0,
                        points: renderInfo.points || 0,
                        lines: renderInfo.lines || 0,
                    }
                    : null,
            };
        }

        const sorted = [...frames].sort((a, b) => a - b);
        const averageMs = frames.reduce((sum, frameMs) => sum + frameMs, 0) / frames.length;
        const p95FrameMs = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
        const worstCount = Math.max(1, Math.ceil(sorted.length * 0.01));
        const worstFrames = sorted.slice(-worstCount);
        const worstAverageMs = worstFrames.reduce((sum, frameMs) => sum + frameMs, 0) / worstFrames.length;

        return {
            sampleCount: frames.length,
            averageFps: roundMetric(1000 / averageMs),
            p95FrameMs: roundMetric(p95FrameMs),
            low1Fps: roundMetric(1000 / worstAverageMs),
            render: renderInfo
                ? {
                    calls: renderInfo.calls || 0,
                    triangles: renderInfo.triangles || 0,
                    points: renderInfo.points || 0,
                    lines: renderInfo.lines || 0,
                }
                : null,
        };
    }

    collectSignoffSnapshot() {
        const preset = this.activePreset || {};
        const atmosphere = preset.atmosphere || {};
        const post = this.oceanPost || null;
        const biomeSilhouetteCount = this.scene
            ? (() => {
                let count = 0;
                this.scene.traverse((child) => {
                    if (child.userData?.isBiomeSilhouette) count += 1;
                });
                return count;
            })()
            : 0;
        const kelpCurtainCount = this.scene
            ? (() => {
                let count = 0;
                this.scene.traverse((child) => {
                    if (child.userData?.isKelpCurtain) count += 1;
                });
                return count;
            })()
            : 0;
        const occluderMeshCount = this.scene
            ? (() => {
                let count = 0;
                this.scene.traverse((child) => {
                    if (child.userData?.isGodRayOccluder) count += child.count || 1;
                });
                return count;
            })()
            : 0;

        return {
            theme: this.name,
            active: this.isActive === true,
            backend: this.getBackendLabel(),
            isWebGPU: this.isWebGPU === true,
            artDirection: OCEAN_ART_DIRECTION,
            flags: {
                forceWebGL: this.flags?.forceWebGL === true,
            },
            quality: {
                current: this.currentQuality,
                requested: this.webglFallbackClampedFromQuality || this.currentQuality,
                fallbackClamp: {
                    clamped: this.webglFallbackClamped === true,
                    from: this.webglFallbackClampedFromQuality,
                    to: this.webglFallbackClamped ? this.currentQuality : null,
                },
            },
            post: {
                enabled: post?.enabled === true,
                className: post?.constructor?.name || null,
                dofEnabled: preset.dofEnabled === true && this.isWebGPU === true,
                dofStrength: roundMetric(post?.uDofStrength?.value ?? 0, 4),
                dofMaxRadius: roundMetric(post?.uDofMaxRadius?.value ?? 0, 5),
                dofDeadZone: roundMetric(post?.uDofDeadZone?.value ?? 0, 5),
                focalDepth: roundMetric(post?.uFocalDepth?.value ?? null, 4),
                chromaticStrength: roundMetric(post?.uChromaStrength?.value ?? 0, 5),
                refractionStrength: roundMetric(post?.uRefractionStrength?.value ?? 0, 5),
                gameplayPulse: roundMetric(post?.uGameplayPulse?.value ?? 0, 4),
                comboSurge: roundMetric(post?.uComboSurge?.value ?? 0, 4),
                causticSweepStrength: roundMetric(post?.uCausticSweepStrength?.value ?? 0, 4),
                bloomStrength: roundMetric(
                    post?.bloomNode?.strength?.value ?? post?.bloomPass?.strength ?? 0,
                    4,
                ),
                bloomScale: roundMetric(post?.bloomScale ?? 0, 3),
                sceneScale: roundMetric(post?.sceneScale ?? 1, 3),
            },
            compute: {
                requested: preset.useGPUCompute === true,
                fish: 'cpu-deferred',
                plankton: 'cpu',
                bubbles: 'cpu',
                storageBufferFish: false,
            },
            visuals: {
                habitat: this.habitatMetrics,
                camera: this.oceanCamera?.collectSignoff?.() ?? null,
                plannedOccluders: atmosphere.occluderCount ?? 0,
                occluderPositions: this.atmosphereSystem?.occluderPositions?.length ?? 0,
                occluderInstances: occluderMeshCount,
                plannedBiomeSilhouettes: atmosphere.biomeSilhouetteCount ?? 0,
                biomeSilhouettes: biomeSilhouetteCount,
                kelpCurtains: kelpCurtainCount,
                atmosphereAssets: this.atmosphereSystem?.collectSignoff?.() ?? null,
                refractionEnabled: preset.refractionEnabled === true && this.isWebGPU === true,
                refractionSource:
                    post?.uRefractionStrength?.value > 0 ? 'post-screen-space' : 'disabled',
                chromaticEdge: preset.chromaticEdge ?? 0,
                shaftStrength: preset.shaftStrength ?? atmosphere.rayStrength ?? 0,
                godRaySamples: preset.godRaySamples ?? atmosphere.rayCount ?? 0,
                particlePrimitive: this.isWebGPU ? 'billboard-quad' : 'points',
                webgpuPointSprites: false,
            },
            counts: {
                fish: preset.fishCount ?? 0,
                heroFish: preset.heroFishCount ?? 0,
                seaweed: preset.seaweedCount ?? 0,
                coral: preset.coralCount ?? 0,
                jellyfish: preset.jellyfishCount ?? 0,
                plankton: preset.planktonCount ?? 0,
                bubbles: preset.bubbleCount ?? 0,
            },
            faunaAssets: {
                version: OCEAN_FAUNA_ASSET_VERSION,
                manifest: summarizeFaunaAssetManifest(),
                fish: this.fishSystem?.collectSignoff?.() ?? null,
                rareFauna: this.rareFaunaSystem?.collectSignoff?.() ?? null,
            },
            gameplayEffects: this.gameplayEffects?.collectSignoff?.() ?? null,
            rareFauna: this.rareFaunaSystem?.collectSignoff?.() ?? null,
            performance: this.getSignoffPerformanceSnapshot(),
        };
    }

    installSignoffHelper() {
        if (typeof window === 'undefined') return;
        const helper = {
            snapshot: () => this.collectSignoffSnapshot(),
            report: () => this.collectSignoffSnapshot(),
            forceRareFauna: (kind = 'turtle') => (
                this.rareFaunaSystem?.forceSpawn?.(kind) ?? Promise.resolve(false)
            ),
            forceHeroFish: (assetId = 'hero-reef-fish') => (
                this.fishSystem?.forceHeroAssetFish?.(assetId) ?? false
            ),
            download: (label = 'ocean-signoff') => {
                const snapshot = this.collectSignoffSnapshot();
                const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
                    type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${label}-${Date.now()}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                return snapshot;
            },
        };
        this.signoffHelper = helper;
        window.oceanSignoff = helper;
    }

    uninstallSignoffHelper() {
        if (typeof window !== 'undefined' && window.oceanSignoff === this.signoffHelper) {
            delete window.oceanSignoff;
        }
        this.signoffHelper = null;
    }

    applyQualityPreset(quality) {
        const resolvedQuality = this.qualityPresets[quality] ? quality : 'High';
        this.currentQuality = resolvedQuality;
        this.activePreset = this.qualityPresets[resolvedQuality];
        if (this.isActive && this.scene) this.rebuildScene();
        console.log(`🌊 [OceanTheme] Applied ${resolvedQuality} quality preset`);
    }

    rebuildScene() {
        this.disposeSceneContents();
        this.buildScene();
    }

    disposeSceneContents() {
        if (!this.scene) return;
        // Invalidate any in-flight staged build steps from a previous
        // buildScene() call so they don't re-populate after disposal.
        this._sceneBuildToken = (this._sceneBuildToken || 0) + 1;
        if (this.fishSystem) {
            this.fishSystem.dispose();
            this.fishSystem = null;
        }
        if (this.reefDwellerSystem) {
            this.reefDwellerSystem.dispose();
            this.reefDwellerSystem = null;
        }
        if (this.rareFaunaSystem) {
            this.rareFaunaSystem.dispose();
            this.rareFaunaSystem = null;
        }
        if (this.oceanPost) {
            this.oceanPost.dispose();
            this.oceanPost = null;
        }
        if (this.atmosphereSystem) {
            this.atmosphereSystem.dispose();
            this.atmosphereSystem = null;
        }
        if (this.gameplayEffects) {
            this.gameplayEffects.dispose();
            this.gameplayEffects = null;
        }
        const toRemove = [];
        this.scene.traverse((obj) => {
            if (obj !== this.scene && obj !== this.camera) {
                toRemove.push(obj);
            }
        });
        toRemove.forEach((obj) => {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
                else obj.material.dispose();
            }
        });
        this.uniformsToUpdate = [];
        this._tslUniforms = null;
        this.jellyfishData = null;
        this.planktonData = null;
        this.bubbleBillboardData = null;
        this.bubbleData = null;
        this.resetHabitatMetrics();
        this.rareFaunaSystem = null;
    }

    setupQualityListener() {
        this.teardownQualityListener();
        this.qualityChangeHandler = (event) => {
            const newQuality = event.detail?.effectQuality;
            if (newQuality && newQuality !== this.currentQuality) this.applyQualityPreset(newQuality);
        };
        window.addEventListener('settingsChanged', this.qualityChangeHandler);
    }

    teardownQualityListener() {
        if (this.qualityChangeHandler) {
            window.removeEventListener('settingsChanged', this.qualityChangeHandler);
            this.qualityChangeHandler = null;
        }
    }

    /**
     * Try WebGPU first, fall back to WebGL2 (mirrors black-hole-theme.js)
     */
    async initRenderer(container) {
        const width = window.innerWidth;
        const height = window.innerHeight;
        let webgpuRenderer = null;

        this.webglFallbackClamped = false;
        this.webglFallbackClampedFromQuality = null;

        if (!this.flags.forceWebGL) {
            try {
                webgpuRenderer = new THREE_WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                });
                await webgpuRenderer.init();
            } catch (error) {
                console.warn('🌊 [Ocean] WebGPU init failed, falling back to WebGL2:', error);
                if (webgpuRenderer) {
                    webgpuRenderer.dispose();
                    webgpuRenderer = null;
                }
            }
        } else {
            console.log('🌊 [Ocean] forceWebGL=1 active; skipping WebGPU init');
        }

        if (webgpuRenderer && webgpuRenderer.backend?.isWebGPUBackend === true) {
            this.renderer = webgpuRenderer;
            this.isWebGPU = true;
            this.renderer.onDeviceLost = (info) => {
                console.error('🌊 [Ocean] WebGPU device lost:', info);
            };
        } else {
            if (webgpuRenderer) webgpuRenderer.dispose();
            this.renderer = new THREE.WebGLRenderer({
                antialias: this.getAntialiasEnabled(),
                alpha: false,
                powerPreference: 'high-performance',
            });
            this.isWebGPU = false;
        }

        console.log(`🌊 [Ocean] Using ${this.isWebGPU ? 'WebGPU' : 'WebGL2'} backend`);

        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        // Tropical-cyan clear, slightly deeper than the fog so the horizon
        // dome reads as bright water rather than featureless overcast.
        this.renderer.setClearColor(0x2f8eb0);

        if (!this.isWebGPU) {
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.12;
        }

        const canvas = this.renderer.domElement;
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none';
        container.appendChild(canvas);

        // Clamp WebGL fallback to Medium quality max
        if (!this.isWebGPU) {
            const maxWebGL = ['Minimal', 'Low', 'Medium'];
            if (!maxWebGL.includes(this.currentQuality)) {
                this.webglFallbackClamped = true;
                this.webglFallbackClampedFromQuality = this.currentQuality;
                console.warn('🌊 [Ocean] WebGL fallback: clamping quality to Medium');
                this.applyQualityPreset('Medium');
            }
        }
    }

    async createScene() {
        const themeContainer = document.getElementById('ocean-theme');
        if (!themeContainer) return;

        themeContainer.innerHTML = '';
        themeContainer.style.background = '#2f8eb0';

        this.applyQualityPreset(this.getGraphicsQuality());
        this.setupQualityListener();
        this.clock = new THREE.Clock();

        await this.initRenderer(themeContainer);

        this.scene = new THREE.Scene();
        // Tropical-cyan fog tuned between dark mood and washed-out — slightly
        // deeper hue + a touch more density so the distance has visible
        // atmospheric falloff instead of reading as a uniform pale dome.
        this.scene.fog = new THREE.FogExp2(0x2f8eb0, 0.0036);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.5,
            350,
        );
        this.camera.position.set(0, 20, 80);
        this.camera.lookAt(0, 5, 0);

        // Wire GPU resilience (mirrors black-hole)
        this.setupRendererResilience(this.renderer, {
            onContextLost: () => console.warn('🌊 [Ocean] GPU context lost'),
            onContextRestored: () => console.log('🌊 [Ocean] GPU context restored'),
        });

        this.buildScene();
        this.setupEventListeners();
        this.installSignoffHelper();
        this.handleResize();
        this.startAnimation();
    }

    buildScene() {
        this.resetHabitatMetrics();
        this._sceneBuildToken = (this._sceneBuildToken || 0) + 1;
        const token = this._sceneBuildToken;

        // Critical visuals — block the first visible frame.
        // Water + seabed + atmosphere (god rays, haze) + lighting give the
        // "underwater void with shafts" look that defines the theme.
        if (!this.flags.noWater) this.createWaterSurface();
        if (!this.flags.noSeabed) this.createSeabed();
        if (!this.flags.noAtmosphere) this.createCinematicAtmosphere();
        this.createLighting();

        // Kick off WebGPU pipeline compilation in parallel with the staged
        // build below — moves shader compile cost off the first render frame.
        if (this.isWebGPU && this.renderer?.compileAsync) {
            try {
                this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
            } catch (err) {
                // compileAsync isn't critical; ignore failures.
            }
        }

        // Stage the rest in idle slices after the first paint. Animation loop
        // already null-safes every subsystem, so partial scenes render fine
        // while we fill in. Each step is no-op'd if its debug flag is set so
        // the user can isolate the cost of each subsystem with ?oceanNoX=1.
        const steps = [
            () => { if (!this.flags.noFish) this.createFishSchools(); },
            () => { if (!this.flags.noJellyfish) this.createJellyfish(); },
            () => { if (!this.flags.noBubbles) this.createBubbles(); },
            () => { if (!this.flags.noPlankton) this.createPlankton(); },
            () => { if (!this.flags.noAtmosphere) this.finalizeCinematicAtmosphere(); },
            () => { if (!this.flags.noCoral) this.createCoralReef(); },
            () => { if (!this.flags.noSeaweed) this.createSeaweed(); },
            () => { if (!this.flags.noSeagrass) this.createSeagrassMeadow(); },
            () => { if (!this.flags.noDwellers) this.createReefDwellers(); },
            () => { if (!this.flags.noRareFauna) this.createRareFauna(); },
            () => { if (!this.flags.noGameplayFx) this.createGameplayEffects(); },
            () => {
                if (this.flags.noPost) return;
                this.ensureMrtMaterials();
                this.setupPostProcessing();
            },
        ];

        const scheduleDeferredBuildStep = (callback, timeout = 180) => {
            const idle = typeof window !== 'undefined' && window.requestIdleCallback
                ? window.requestIdleCallback.bind(window)
                : null;
            if (idle) {
                idle(callback, { timeout });
            } else {
                setTimeout(callback, 24);
            }
        };

        // Names parallel to `steps` for ?oceanLogStartup= timing logs.
        const stepNames = [
            'createFishSchools', 'createJellyfish', 'createBubbles', 'createPlankton',
            'finalizeCinematicAtmosphere', 'createCoralReef', 'createSeaweed',
            'createSeagrassMeadow', 'createReefDwellers', 'createRareFauna',
            'createGameplayEffects', 'setupPostProcessing',
        ];
        const { logStartup } = this.flags;
        const runStep = (index) => {
            // Bail if disposeSceneContents() or stop() bumped the token,
            // or if the scene was torn down between frames.
            if (token !== this._sceneBuildToken || !this.scene) return;
            const step = steps[index];
            if (!step) return;
            const stepStart = logStartup ? performance.now() : 0;
            try {
                step();
            } catch (err) {
                console.warn('🌊 [Ocean] deferred build step failed:', err);
            }
            if (logStartup) {
                const ms = (performance.now() - stepStart).toFixed(1);
                console.log(`[Ocean] startup step ${stepNames[index] || index}: ${ms}ms`);
            }
            if (index + 1 < steps.length) {
                scheduleDeferredBuildStep(() => runStep(index + 1));
            }
        };
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                scheduleDeferredBuildStep(() => runStep(0), 120);
            });
        });
    }

    createCinematicAtmosphere() {
        this.atmosphereSystem = new OceanAtmosphereSystem({
            scene: this.scene,
            camera: this.camera,
            preset: this.activePreset,
            getSeabedHeight: this.getSeabedHeight.bind(this),
            isWebGPU: this.isWebGPU,
            // Diagnostic skip flags — let us A/B which atmosphere component
            // drives the 16 ms `ocean.post` cost spike.
            skipFlags: {
                haze: this.flags.noHaze,
                beamDust: this.flags.noBeamDust,
                glowAnchors: this.flags.noGlowAnchors,
                bioSilhouettes: this.flags.noBioSilhouettes,
                heroCoral: this.flags.noHeroCoral,
                heroKelp: this.flags.noHeroKelp,
                heroReef: this.flags.noHeroReef,
                coralCarpets: this.flags.noCoralCarpets,
                foregroundRocks: this.flags.noForegroundRocks,
                importedSeabed: this.flags.noImportedSeabed,
                reefSilhouettes: this.flags.noReefSilhouettes,
                arches: this.flags.noArches,
            },
        });
        // Only critical atmosphere (shafts, haze, glow, beam dust, silhouettes)
        // runs synchronously. The heavy procedural anchors are completed by
        // finalizeCinematicAtmosphere() as a deferred build step.
        this.atmosphereSystem.initCritical();
    }

    finalizeCinematicAtmosphere() {
        if (!this.atmosphereSystem) return;
        this.atmosphereSystem.initDeferred();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WATER SURFACE - Waves-style shader with Gerstner waves (viewed from below)
    // ═══════════════════════════════════════════════════════════════════════════
    createWaterSurface() {
        // Large plane above the scene representing water surface from below.
        // Phase H.3: tessellation reduced 128×128 → 64×64 (16k → 4k verts).
        // Bisect showed water surface costs +8 fps at Extreme; this gets most
        // of that back. The wave shader is per-vertex so cost scales linearly
        // with vertex count, and the surface is above the camera viewing the
        // scene from below — fine-grained tessellation is invisible.
        const geometry = new THREE.PlaneGeometry(500, 500, 64, 64);
        geometry.rotateX(Math.PI / 2);

        if (this.isWebGPU) {
            const refractionEnabled = this.activePreset?.refractionEnabled === true;
            const material = createWaterSurfaceNodeMaterial({
                waveIntensity: 1.0,
                surfaceShimmerStrength: refractionEnabled ? 0.35 : 0.12,
            });
            this.waterSurface = new THREE.Mesh(geometry, material);
            this.waterSurface.position.y = 72;
            this.waterSurfaceMaterial = material;
            // Store TSL uniforms for per-frame updates
            this._tslUniforms = this._tslUniforms || [];
            this._tslUniforms.push(material.userData);
            this.scene.add(this.waterSurface);
            return;
        }

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                // Deeper, more saturated palette to match reference photo —
                // less bright cyan, more cobalt/sapphire with warm-tinted highlights.
                uDeepColor: { value: new THREE.Color(0x001830) },
                uMidColor: { value: new THREE.Color(0x004068) },
                uSurfaceColor: { value: new THREE.Color(0x0a6f95) },
                uCrestColor: { value: new THREE.Color(0x3aa8c0) },
                uFoamColor: { value: new THREE.Color(0xc9f4e8) },
                uWaveIntensity: { value: 1.0 },
                uCausticsIntensity: { value: 0.24 },
                uGlowIntensity: { value: 0.0 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uWaveIntensity;
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                varying vec2 vUv;
                varying float vElevation;
                
                // Perlin noise
                vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
                
                float cnoise(vec3 P) {
                    vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
                    Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
                    vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
                    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
                    vec4 iy = vec4(Pi0.yy, Pi1.yy); vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
                    vec4 ixy = permute(permute(ix) + iy);
                    vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
                    vec4 gx0 = ixy0 / 7.0; vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
                    gx0 = fract(gx0); vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
                    vec4 sz0 = step(gz0, vec4(0.0));
                    gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
                    vec4 gx1 = ixy1 / 7.0; vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
                    gx1 = fract(gx1); vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
                    vec4 sz1 = step(gz1, vec4(0.0));
                    gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
                    vec3 g000 = vec3(gx0.x,gy0.x,gz0.x); vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
                    vec3 g010 = vec3(gx0.z,gy0.z,gz0.z); vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
                    vec3 g001 = vec3(gx1.x,gy1.x,gz1.x); vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
                    vec3 g011 = vec3(gx1.z,gy1.z,gz1.z); vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
                    vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000),dot(g010,g010),dot(g100,g100),dot(g110,g110)));
                    g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
                    vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001),dot(g011,g011),dot(g101,g101),dot(g111,g111)));
                    g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
                    float n000 = dot(g000, Pf0); float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
                    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)); float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
                    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z)); float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
                    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)); float n111 = dot(g111, Pf1);
                    vec3 fade_xyz = fade(Pf0);
                    vec4 n_z = mix(vec4(n000,n100,n010,n110), vec4(n001,n101,n011,n111), fade_xyz.z);
                    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
                    return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
                }
                
                // Gerstner wave
                vec3 gerstnerWave(vec2 dir, float steep, float wlen, vec3 p, float t) {
                    float k = 6.28318 / wlen;
                    float c = sqrt(9.8 / k);
                    vec2 d = normalize(dir);
                    float f = k * (dot(d, p.xz) - c * t);
                    float a = steep / k;
                    return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
                }
                
                void main() {
                    vUv = uv;
                    vec3 pos = position;
                    float time = uTime * 0.5;
                    
                    // Gerstner waves
                    vec3 wave = vec3(0.0);
                    wave += gerstnerWave(vec2(1.0, 0.3), 0.2, 25.0, pos, time);
                    wave += gerstnerWave(vec2(0.7, 0.7), 0.15, 18.0, pos, time * 1.1);
                    wave += gerstnerWave(vec2(-0.4, 0.9), 0.1, 12.0, pos, time * 0.9);
                    wave += gerstnerWave(vec2(0.9, -0.2), 0.08, 9.0, pos, time * 0.85);
                    
                    // Perlin noise detail
                    float noise = cnoise(vec3(pos.xz * 0.08, time * 0.3)) * 0.4;
                    noise += cnoise(vec3(pos.xz * 0.04, time * 0.2)) * 0.3;
                    
                    float displacement = (wave.y + noise) * uWaveIntensity;
                    vElevation = displacement;
                    
                    pos.y += displacement * 1.5;
                    pos.x += wave.x * 0.3;
                    pos.z += wave.z * 0.3;
                    
                    vPosition = pos;
                    vNormal = normal;
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uDeepColor;
                uniform vec3 uMidColor;
                uniform vec3 uSurfaceColor;
                uniform vec3 uCrestColor;
                uniform vec3 uFoamColor;
                uniform float uCausticsIntensity;
                uniform float uGlowIntensity;
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                varying vec2 vUv;
                varying float vElevation;
                
                // Simplex noise for caustics
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
                    vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx);
                    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                    m = m*m; m = m*m;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                    vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }
                
                void main() {
                    float heightFactor = clamp(vElevation * 1.5 + 0.5, 0.0, 1.0);
                    float depthFactor = clamp((vPosition.z + 150.0) / 300.0, 0.0, 1.0);
                    
                    // Color gradient
                    vec3 color = mix(uDeepColor, uMidColor, depthFactor * 0.6);
                    color = mix(color, uSurfaceColor, depthFactor * 0.62);
                    color = mix(color, uCrestColor, heightFactor * 0.32);
                    
                    // Lighting from above
                    vec3 lightDir = normalize(vec3(0.2, -0.9, 0.1));
                    vec3 viewDir = normalize(cameraPosition - vPosition);
                    float diffuse = max(dot(-vWorldNormal, lightDir), 0.0);
                    diffuse = pow(diffuse, 0.5) * 0.6 + 0.3;
                    
                    // Specular (shimmering water)
                    vec3 halfDir = normalize(lightDir + viewDir);
                    float specular = pow(max(dot(-vWorldNormal, halfDir), 0.0), 48.0);
                    
                    // Fresnel (glassy edge)
                    float fresnel = pow(1.0 - max(dot(-vWorldNormal, viewDir), 0.0), 2.5);
                    
                    // Caustics on water surface
                    vec2 causticsUV = vPosition.xz * 0.15;
                    float c1 = snoise(causticsUV + uTime * 0.2);
                    float c2 = snoise(causticsUV * 1.4 - uTime * 0.15);
                    float c3 = snoise(causticsUV * 0.8 + uTime * 0.25);
                    float caustics = (c1 + c2 + c3) * 0.33;
                    caustics = pow(max(caustics, 0.0), 2.0) * uCausticsIntensity;
                    float fineCaustics = pow(max(snoise(causticsUV * 2.7 - uTime * 0.34), 0.0), 3.0)
                        * uCausticsIntensity * 0.36;
                    float latticeA = abs(sin(vPosition.x * 0.24 + uTime * 0.48));
                    float latticeB = abs(sin(vPosition.z * 0.22 - uTime * 0.42));
                    float lattice = pow(max(latticeA * latticeB, 0.0), 5.5) * uCausticsIntensity * 0.28;
                    
                    // Foam at wave crests
                    float foamNoise = snoise(vPosition.xz * 0.8 + uTime * 0.1);
                    float foam = smoothstep(0.35, 0.65, vElevation) * (foamNoise * 0.35 + 0.5);
                    
                    // Sub-surface scattering
                    float sss = pow(max(dot(-viewDir, lightDir), 0.0), 3.0) * 0.3;
                    
                    // Combine
                    color *= diffuse;
                    color += vec3(0.82, 0.96, 0.9) * specular * 0.24;
                    color += uCrestColor * fresnel * 0.18;
                    color += uCrestColor * (caustics + fineCaustics + lattice) * 0.68;
                    color += uSurfaceColor * sss * 0.48;
                    color = mix(color, uFoamColor, foam * 0.2);
                    color += uCrestColor * uGlowIntensity * 0.08;
                    color = mix(color, uDeepColor, 0.11);
                    
                    // Edge fade - smooth transition at water surface edges
                    float distFromCenter = length(vUv - 0.5) * 2.0;
                    float edgeFade = 1.0 - smoothstep(0.75, 1.0, distFromCenter);
                    
                    // View angle fade - gentler fade for better visibility
                    float viewFade = smoothstep(0.0, 0.25, abs(dot(-vWorldNormal, viewDir)));
                    
                    float alpha = edgeFade * (0.24 + viewFade * 0.24);
                    
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
        });

        this.waterSurface = new THREE.Mesh(geometry, material);
        this.waterSurface.position.y = 72;
        this.waterSurfaceMaterial = material;
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.waterSurface);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GOD RAYS - Volumetric light beams from surface
    // ═══════════════════════════════════════════════════════════════════════════
    createGodRays() {
        const rayCount = 10;
        const positions = [];
        const uvs = [];

        for (let i = 0; i < rayCount; i++) {
            const w = 18 + Math.random() * 15;
            const h = 180;
            const x = (i - rayCount / 2) * 22 + (Math.random() - 0.5) * 25;
            const y = 90;
            const z = -25 - i * 10 + (Math.random() - 0.5) * 15;
            const rot = (Math.random() - 0.5) * 0.35;

            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const hw = w / 2;
            const hh = h / 2;

            const verts = [
                [-hw, -hh],
                [hw, -hh],
                [hw, hh],
                [-hw, -hh],
                [hw, hh],
                [-hw, hh],
            ];
            const uv = [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
                [1, 1],
                [0, 1],
            ];

            verts.forEach((v, idx) => {
                positions.push(x + v[0] * cos - v[1] * sin, y + v[0] * sin + v[1] * cos, z);
                uvs.push(uv[idx][0], uv[idx][1]);
            });
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.65 } },
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
                    // Soft ray shape with smooth falloff
                    float rayX = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
                    float rayY = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
                    float ray = rayX * rayY;
                    
                    // Animated shimmer
                    ray *= 0.8 + sin(vUv.y * 25.0 + uTime * 1.8) * 0.2;
                    
                    vec3 color = vec3(0.32, 0.64, 0.72) * ray * uIntensity;
                    gl_FragColor = vec4(color, ray * 0.22 * uIntensity);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.godRays = new THREE.Mesh(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.godRays);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEABED - Sandy ocean floor with caustic lighting
    // ═══════════════════════════════════════════════════════════════════════════
    createSeabed() {
        const segments = this.activePreset.terrainSegments;
        const geometry = new THREE.PlaneGeometry(400, 400, segments, segments);
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            positions.setY(i, this.getSeabedHeight(x, z));
        }
        geometry.computeVertexNormals();

        if (this.isWebGPU) {
            const material = createSeabedNodeMaterial({
                rippleStrength: this.activePreset.rippleNormalStrength ?? 1.6,
                causticStrength: this.activePreset.causticStrength ?? 0.55,
            });
            this.seabed = new THREE.Mesh(geometry, material);
            this._tslUniforms = this._tslUniforms || [];
            this._tslUniforms.push(material.userData);
            this.scene.add(this.seabed);
            return;
        }

        const seabedPreset = this.activePreset;
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSandShadow: { value: new THREE.Color().setRGB(0.68, 0.62, 0.52) },
                uSandMid: { value: new THREE.Color().setRGB(0.88, 0.84, 0.74) },
                uSandLit: { value: new THREE.Color().setRGB(0.98, 0.96, 0.88) },
                uFogShallow: { value: new THREE.Color().setRGB(0.05, 0.52, 0.70) },
                uFogDeep: { value: new THREE.Color().setRGB(0.02, 0.28, 0.48) },
                uRippleStrength: { value: seabedPreset.rippleNormalStrength ?? 2.2 },
                uCausticStrength: { value: seabedPreset.causticStrength ?? 0.95 },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying float vHeight;
                varying float vDist;
                varying vec2 vWorldXZ;
                varying vec3 vWorldPos;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vHeight = position.y;
                    // The seabed plane is rotated -90 on X so world XZ comes from local (x, z).
                    vWorldXZ = vec2(position.x, position.z);
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    vDist = length(mvPos.xyz);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uSandShadow;
                uniform vec3 uSandMid;
                uniform vec3 uSandLit;
                uniform vec3 uFogShallow;
                uniform vec3 uFogDeep;
                uniform float uRippleStrength;
                uniform float uCausticStrength;
                varying vec3 vNormal;
                varying float vHeight;
                varying float vDist;
                varying vec2 vWorldXZ;
                varying vec3 vWorldPos;

                float hash21(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                float noise2d(vec2 p) {
                    vec2 i = floor(p);
                    vec2 f = fract(p);
                    vec2 u = f * f * (3.0 - 2.0 * f);
                    float a = hash21(i);
                    float b = hash21(i + vec2(1.0, 0.0));
                    float c = hash21(i + vec2(0.0, 1.0));
                    float d = hash21(i + vec2(1.0, 1.0));
                    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
                }
                float fbm2(vec2 p) {
                    float v = 0.0;
                    float a = 0.5;
                    for (int i = 0; i < 2; i++) {
                        v += a * noise2d(p);
                        p *= 2.0;
                        a *= 0.5;
                    }
                    return v;
                }
                // Procedural sand ripple bands — shared height field fuels both colour modulation and analytic normal.
                float rippleHeight(vec2 xz) {
                    // Perturb coordinates using low frequency noise
                    vec2 perturbed = xz + noise2d(xz * 0.04) * 3.5;
                    vec2 currentDir = vec2(0.22, 0.97);

                    // Phase of the sand waves aligned to the current
                    float theta = dot(perturbed, currentDir) * 0.34;
                    // Skewed asymmetric wave profile: sin(theta - 0.4 * sin(theta))
                    float skewedWave = sin(theta - 0.4 * sin(theta)) * 0.5 + 0.5;

                    // Layer medium scale ripples
                    float thetaMed = dot(perturbed, currentDir) * 0.85;
                    float skewedMed = sin(thetaMed - 0.35 * sin(thetaMed)) * 0.5 + 0.5;

                    return skewedWave * 0.7 + skewedMed * 0.3 + fbm2(xz * 0.6) * 0.2;
                }

                void main() {
                    float hf = smoothstep(-25.0, 10.0, vHeight);
                    vec3 color = mix(uSandShadow, uSandMid, hf);

                    vec2 pxz = vWorldXZ;
                    float eps = 0.35;
                    float h0 = rippleHeight(pxz);
                    float hx = rippleHeight(pxz + vec2(eps, 0.0));
                    float hz = rippleHeight(pxz + vec2(0.0, eps));
                    float rippleFalloff = 1.0 - smoothstep(90.0, 190.0, vDist);
                    float rippleN = uRippleStrength * rippleFalloff;
                    vec3 rippleNormal = normalize(vec3((h0 - hx) * rippleN, 1.0, (h0 - hz) * rippleN));
                    vec3 litNormal = normalize(mix(vNormal, rippleNormal, 0.78));

                    // High-frequency sand grain normal perturbation
                    float grainEps = 0.08;
                    float grainFreq = 22.0;
                    float g0 = noise2d(pxz * grainFreq);
                    float gx = noise2d((pxz + vec2(grainEps, 0.0)) * grainFreq);
                    float gz = noise2d((pxz + vec2(0.0, grainEps)) * grainFreq);
                    
                    float microFalloff = 1.0 - smoothstep(35.0, 75.0, vDist);
                    float grainN = 0.24 * microFalloff;
                    vec3 grainNormal = vec3((g0 - gx) * grainN, 0.0, (g0 - gz) * grainN);
                    vec3 finalNormal = normalize(litNormal + grainNormal);

                    // Ripple-crest warmth: only ridges facing the sun lift toward shell sand.
                    vec3 lightDir = normalize(vec3(0.16, 0.92, -0.18));
                    float ridgeWarmth = pow(max(dot(rippleNormal, lightDir), 0.0), 2.4);

                    // 1. Procedural silt & sediment channels (organic brown/grey patches)
                    vec3 siltColor = vec3(0.38, 0.34, 0.28);
                    float siltNoise = fbm2(vWorldXZ * 0.045);
                    float siltWeight = smoothstep(0.42, 0.72, siltNoise) * 0.68;

                    // Stoss / Lee shading adjustments based on alignment with dominant current direction
                    vec2 currentDir = vec2(0.22, 0.97);
                    float stossAlign = dot(rippleNormal.xz, currentDir);

                    // Lee side (deposition of organic silt)
                    float leeWeight = smoothstep(-0.6, -0.05, -stossAlign);
                    siltWeight = clamp(siltWeight + leeWeight * 0.32, 0.0, 0.85);
                    color = mix(color, siltColor, siltWeight);

                    // Stoss side (erosion of silt, clean sand facing the flow)
                    float stossWeight = smoothstep(0.05, 0.55, stossAlign);

                    // 2. Deep ripple valley shadowing (darken troughs, highlight crests)
                    float h0Clamped = clamp(h0, 0.0, 1.0);
                    float rippleValleyDarkening = mix(0.65, 1.0, h0Clamped);
                    color *= rippleValleyDarkening;

                    float terraceBands = sin(vWorldXZ.y * 0.19 + vWorldXZ.x * 0.035) * 0.5 + 0.5;
                    float reefShelfMask = smoothstep(0.56, 0.95, terraceBands) * smoothstep(-23.0, -8.0, vHeight);
                    color += vec3(0.06, 0.24, 0.24) * reefShelfMask * 0.18;

                    // 3. Micro-grit color overlay
                    float sandGrainNoise = fbm2(vWorldXZ * 0.085);
                    color *= 0.88 + sandGrainNoise * 0.16;
                    float microGrit = noise2d(vWorldXZ * 48.0);
                    color *= 0.92 + microGrit * 0.12;

                    // Ripple crest warmth & stoss exposure highlights
                    color = mix(color, uSandLit, ridgeWarmth * 0.46 + stossWeight * 0.28);

                    // Balanced caustics to prevent clipping/wash-out on bright sand.
                    float c1 = sin(vWorldXZ.x * 0.12 + uTime * 0.7) * sin(vWorldXZ.y * 0.1 + uTime * 0.5);
                    float c2 = sin(vWorldXZ.x * 0.18 - uTime * 0.6) * sin(vWorldXZ.y * 0.15 + uTime * 0.8);
                    float c3 = sin((vWorldXZ.x + vWorldXZ.y) * 0.09 + uTime * 0.4);
                    float caustic = pow(max(0.0, (c1 + c2 + c3 * 0.35) * 0.42 + 0.34), 4.0);
                    float causticFalloff = 1.0 - smoothstep(80.0, 220.0, vDist);
                    color += vec3(0.85, 0.98, 0.92) * caustic * uCausticStrength * causticFalloff * 0.82;

                    // Specular lighting on wet/crystalline sand
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    vec3 halfVector = normalize(lightDir + viewDir);
                    float specularDot = max(dot(finalNormal, halfVector), 0.0);
                    float specular = pow(specularDot, 42.0) * 0.18 * rippleFalloff;
                    color += vec3(0.9, 0.98, 0.95) * specular;

                    // Twinkling, view-dependent glinting sparkles
                    float sparklePhase = hash21(vWorldXZ * 12.0);
                    float twinkle = sin(uTime * 2.2 + sparklePhase * 6.28);
                    float viewGlint = dot(viewDir, finalNormal);
                    float sparkle = pow(hash21(vWorldXZ * 24.0), 14.0)
                        * (twinkle * 0.5 + 0.5) * (1.0 + viewGlint * 0.5);
                    color += vec3(0.95, 0.98, 0.88) * sparkle * 0.32 * microFalloff;

                    float light = max(0.34, dot(finalNormal, lightDir));
                    color *= light;

                    // Height-based Ambient Occlusion (crevices and deep valleys are darker)
                    float heightFactorAO = smoothstep(-25.0, 8.0, vHeight);
                    float heightAO = mix(0.35, 1.0, heightFactorAO);
                    color *= heightAO;

                    // Depth-based color absorption (deeper is darker blue/green tint)
                    float depthFactor = smoothstep(-35.0, 10.0, vHeight);
                    color = mix(color * 0.25, color, depthFactor);

                    // Vertical depth-graded fog: warm aqua near the surface, deep teal at the floor.
                    float depthMix = smoothstep(-25.0, 24.0, vHeight);
                    vec3 fogColor = mix(uFogDeep, uFogShallow, depthMix);
                    float fog = 1.0 - exp(-vDist * 0.0036);
                    color = mix(color, fogColor, clamp(fog * 0.48, 0.0, 0.62));

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });

        this.seabed = new THREE.Mesh(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.seabed);
    }

    getSeabedHeight(x, z) {
        // Current-aligned flow vector (skewed slightly for dynamic visuals)
        const currentX = 0.22;
        const currentZ = 0.97;
        const perturbX = Math.sin(z * 0.08) * 2.5;
        const perturbZ = Math.cos(x * 0.07) * 2.5;
        const px = x + perturbX;
        const pz = z + perturbZ;

        // Giant sand waves (dunes) - asymmetric stoss/lee profiles aligned to current direction
        const phaseGiant = (px * currentX + pz * currentZ) * 0.08; // Wavelength ~78 units
        const waveGiant = Math.sin(phaseGiant - 0.4 * Math.sin(phaseGiant));

        // Medium sand waves (ridges) - aligned and skewed
        const phaseMedium = (px * currentX + pz * currentZ) * 0.22; // Wavelength ~28 units
        const waveMedium = Math.sin(phaseMedium - 0.45 * Math.sin(phaseMedium));

        const rollers = Math.cos(x * 0.004) * Math.sin(z * 0.004) * 25.0;
        const dunes = waveGiant * 12.0 + waveMedium * 3.5 + rollers;

        // Center flattening / valley reef factor matching reference: keep the play zone flat,
        // but let the dunes rise quickly on the sides and background.
        const distFromCenter = Math.sqrt(x * x + z * z);
        const flattenFactor = THREE.MathUtils.smoothstep(distFromCenter, 15, 65);
        const baseHeight = dunes * flattenFactor - (1.0 - flattenFactor) * 12.0;

        // Gameplay adjustments: side shelf lift and foreground sand channel
        const sideShelfLift = Math.max(0, Math.abs(x) - OCEAN_READABILITY_ZONE.halfWidth) * 0.45;
        const foregroundSandChannel = -Math.exp(
            -((x * x) / (2 * 46 * 46) + ((z - 48) * (z - 48)) / (2 * 70 * 70)),
        ) * 4.0;

        // Micro-ripples - aligned and skewed
        const phaseRipple = (px * currentX + pz * currentZ) * 0.72; // Wavelength ~8.7 units
        const rippleRelief = Math.sin(phaseRipple - 0.4 * Math.sin(phaseRipple)) * 0.75;

        return baseHeight + sideShelfLift + foregroundSandChannel + rippleRelief - 14;
    }

    /**
     * Checks if a point (x, z) is occupied by a rock or coral.
     * Used to prevent seaweed, seagrass, and fish from clipping through geometry.
     */
    isPointOccupied(x, z, radius = 2.0) {
        if (!this.atmosphereSystem) return false;

        const data = this.atmosphereSystem.getOccupancyData();

        // 1. Check hero rock clusters
        for (const cluster of data.clusters) {
            const dx = x - cluster.x;
            const dz = z - cluster.z;
            const distSq = dx * dx + dz * dz;
            const minCenteredDist = (cluster.radius + radius);
            if (distSq < minCenteredDist * minCenteredDist) return true;
        }

        // 2. Check hero corals
        for (const coral of data.corals) {
            const dx = x - coral.x;
            const dz = z - coral.z;
            const distSq = dx * dx + dz * dz;
            const coralRadius = 2.5 * coral.scale; // footprint estimate
            const minCenteredDist = (coralRadius + radius);
            if (distSq < minCenteredDist * minCenteredDist) return true;
        }

        // 3. Check hero reef placements (the large sculpted pieces)
        for (const reef of data.reefs) {
            const dx = x - reef.x;
            const dz = z - reef.z;
            const distSq = dx * dx + dz * dz;
            const reefRadius = 8.0 * reef.scale; // large footprint
            const minCenteredDist = (reefRadius + radius);
            if (distSq < minCenteredDist * minCenteredDist) return true;
        }

        // 4. Check dynamic reef walls
        for (const wall of data.heroReefWalls) {
            const dx = x - wall.x;
            const dz = z - wall.z;
            const distSq = dx * dx + dz * dz;
            const minCenteredDist = (wall.radius + radius);
            if (distSq < minCenteredDist * minCenteredDist) return true;
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEAWEED - Smooth curved kelp with proper geometry (not pixelated)
    // ═══════════════════════════════════════════════════════════════════════════
    createSeaweed() {
        const count = this.activePreset.seaweedCount;
        const spread = 150;

        // Tall ribbon kelp — geometry is taller than before so accent blades can
        // tower to ~6m when scaled, producing the Abzu grove silhouette.
        const segments = 8;
        const width = 0.12;
        const height = 4.8;

        const bladeVertices = [];
        const bladeIndices = [];
        const bladeHeights = [];

        for (let s = 0; s <= segments; s++) {
            const t = s / segments;
            const y = t * height;
            const w = width * (1 - t * 0.7); // Taper towards top

            // Left and right vertices
            bladeVertices.push(-w, y, 0);
            bladeVertices.push(w, y, 0);
            bladeHeights.push(t, t);

            if (s < segments) {
                const i = s * 2;
                bladeIndices.push(i, i + 1, i + 2);
                bladeIndices.push(i + 1, i + 3, i + 2);
            }
        }

        const bladeGeometry = new THREE.BufferGeometry();
        bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladeVertices, 3));
        bladeGeometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(bladeHeights, 1));
        bladeGeometry.setIndex(bladeIndices);
        bladeGeometry.computeVertexNormals();

        if (this.isWebGPU) {
            const bladeMaterial = createSeaweedNodeMaterial({ currentStrength: 0.5 });
            const seaweedMesh = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, count);
            const phases = new Float32Array(count);
            const colorVars = new Float32Array(count);
            const bladeWidths = new Float32Array(count);
            const bladeTypes = new Float32Array(count);
            const dummy = new THREE.Object3D();
            const habitatVariants = { shortGrass: 0, ribbonKelp: 0, tallAccentBlades: 0 };

            for (let i = 0; i < count; i++) {
                let sideBias = 0;
                if (Math.random() < 0.78) sideBias = Math.random() < 0.5 ? -1 : 1;
                let x;
                let z;
                if (Math.random() < 0.58) {
                    ({ x, z } = sampleReefGardenPoint(spread, 1.18));
                } else {
                    x = sideBias === 0
                        ? (Math.random() - 0.5) * spread * 2
                        : sideBias * randRangeLocal(OCEAN_READABILITY_ZONE.halfWidth + 10, spread);
                    z = randRangeLocal(-150, 92);
                }
                const roll = Math.random();
                const bladeType = chooseSeaweedBladeType(roll);
                // Tall accent blades are pinned to hero kelp groves 75% of the time so
                // they form Abzu-style towering silhouettes instead of stray spikes.
                if (bladeType === 2 && Math.random() < 0.75) {
                    ({ x, z } = sampleKelpGrovePoint());
                }
                ({ x, z } = this.nudgeOutOfReadabilityZone(x, z, spread));

                // Collision Check: If this point is inside a rock/coral, try one quick nudge
                // before giving up (to keep distribution dense but clean).
                if (this.isPointOccupied(x, z, 1.5)) {
                    x += (Math.random() - 0.5) * 8;
                    z += (Math.random() - 0.5) * 8;
                    if (this.isPointOccupied(x, z, 1.0)) {
                        // Still occupied? Skip this blade.
                        i--;
                        continue;
                    }
                }

                const y = this.getSeabedHeight(x, z);
                dummy.position.set(x, y, z);
                dummy.rotation.y = Math.random() * Math.PI * 2;
                const curtainScale = Math.abs(x) > 92 || z < -95 ? 1.16 : 1.0;
                const clumpScale = Math.random() < 0.58
                    ? randRangeLocal(0.65, 1.0)
                    : randRangeLocal(1.0, 1.4);
                if (bladeType === 0) {
                    dummy.scale.set(
                        0.75 * clumpScale,
                        randRangeLocal(0.42, 0.7) * curtainScale,
                        0.75 * clumpScale,
                    );
                    bladeWidths[i] = randRangeLocal(0.62, 0.9);
                    habitatVariants.shortGrass += 1;
                } else if (bladeType === 1) {
                    dummy.scale.set(
                        1.05 * clumpScale,
                        randRangeLocal(0.72, 1.32) * curtainScale,
                        1.05 * clumpScale,
                    );
                    bladeWidths[i] = randRangeLocal(1.4, 2.15);
                    habitatVariants.ribbonKelp += 1;
                } else {
                    // Tall grove kelp: scale Y aggressively to reach 6-8m total.
                    dummy.scale.set(
                        1.0 * clumpScale,
                        randRangeLocal(1.55, 2.30) * curtainScale,
                        1.0 * clumpScale,
                    );
                    bladeWidths[i] = randRangeLocal(0.78, 1.12);
                    habitatVariants.tallAccentBlades += 1;
                }
                dummy.updateMatrix();
                seaweedMesh.setMatrixAt(i, dummy.matrix);
                phases[i] = Math.random() * 6.28;
                colorVars[i] = Math.random();
                bladeTypes[i] = bladeType;
            }

            seaweedMesh.geometry.setAttribute(
                'aPhase',
                new THREE.InstancedBufferAttribute(phases, 1),
            );
            seaweedMesh.geometry.setAttribute(
                'aColorVar',
                new THREE.InstancedBufferAttribute(colorVars, 1),
            );
            seaweedMesh.geometry.setAttribute(
                'aBladeWidth',
                new THREE.InstancedBufferAttribute(bladeWidths, 1),
            );
            seaweedMesh.geometry.setAttribute(
                'aBladeType',
                new THREE.InstancedBufferAttribute(bladeTypes, 1),
            );
            seaweedMesh.instanceMatrix.needsUpdate = true;
            seaweedMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            seaweedMesh.computeBoundingSphere();
            if (seaweedMesh.boundingSphere) seaweedMesh.boundingSphere.radius += 6;

            this.seaweedInstances = seaweedMesh;
            this.habitatMetrics.seaweed.instances = count;
            this.habitatMetrics.seaweed.variants = habitatVariants;
            this._tslUniforms = this._tslUniforms || [];
            this._tslUniforms.push(bladeMaterial.userData);
            this.scene.add(seaweedMesh);
            return;
        }

        const bladeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCurrentStrength: { value: 0.5 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                attribute float aHeight;
                attribute float aPhase;
                attribute float aColorVar;
                attribute float aBladeWidth;
                attribute float aBladeType;
                varying float vHeight;
                varying float vColorVar;
                varying float vBladeType;
                varying float vDist;
                varying vec3 vNormal;
                varying vec2 vWorldXZ;
                
                void main() {
                    vec3 pos = position;
                    float ribbonMask = smoothstep(0.55, 1.35, aBladeType);
                    pos.x *= aBladeWidth;
                    pos.x += sin(aHeight * 18.0 + aPhase) * aHeight * ribbonMask * 0.035;
                    vec4 iPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    
                    // Reference organic sway equations
                    float h = aHeight;
                    float phase = aPhase + iPos.x * 0.03 + iPos.z * 0.025;
                    float phaseX = uTime * 1.1 + phase + h * 4.5;
                    float phaseZ = uTime * 0.88 + phase * 0.8 + h * 3.6;
                    pos.x += sin(phaseX) * h * h * uCurrentStrength * (1.1 + ribbonMask * 0.22);
                    pos.z += cos(phaseZ) * h * h * uCurrentStrength * (0.77 + ribbonMask * 0.15);
                    
                    vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
                    vec4 mvPos = modelViewMatrix * worldPos;
                    
                    vHeight = aHeight;
                    vColorVar = aColorVar;
                    vBladeType = aBladeType;
                    vDist = length(mvPos.xyz);
                    vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
                    vWorldXZ = worldPos.xz;
                    
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vHeight;
                varying float vColorVar;
                varying float vBladeType;
                varying float vDist;
                varying vec3 vNormal;
                varying vec2 vWorldXZ;
                uniform float uTime;
                
                void main() {
                    // Rich kelp color gradient
                    vec3 base = vec3(0.06, 0.28, 0.20);
                    vec3 mid = vec3(0.24, 0.55, 0.22);
                    vec3 tip = vec3(0.68, 0.82, 0.24);
                    
                    vec3 color = mix(base, mid, smoothstep(0.0, 0.5, vHeight));
                    color = mix(color, tip, smoothstep(0.5, 1.0, vHeight));
                    
                    // Color variation
                    float ribbonMask = smoothstep(0.55, 1.35, vBladeType);
                    float accentMask = smoothstep(1.45, 2.05, vBladeType);
                    color = mix(color, vec3(0.1, 0.44, 0.32), ribbonMask * 0.24);
                    color = mix(color, vec3(0.06, 0.32, 0.2), accentMask * 0.18);
                    color *= 0.82 + vColorVar * 0.34;
                    
                    // Subtle lighting
                    float light = max(0.56, dot(vNormal, normalize(vec3(0.2, 0.86, -0.08))));
                    color *= light;
                    float caustic = sin(vWorldXZ.x * 0.2 + uTime * 0.55)
                        * sin(vWorldXZ.y * 0.16 - uTime * 0.46);
                    caustic = pow(max(caustic * 0.5 + 0.5, 0.0), 5.0);
                    color += vec3(0.06, 0.27, 0.22) * caustic * (0.14 + vHeight * 0.16);
                    
                    // Translucency effect at tips
                    float translucency = vHeight * 0.15;
                    color += vec3(0.08, 0.2, 0.09) * translucency;
                    
                    // Distance fog
                    vec3 fogColor = vec3(0.02, 0.28, 0.48);
                    float fog = 1.0 - exp(-vDist * 0.007);
                    color = mix(color, fogColor, clamp(fog * 0.78, 0.0, 0.84));
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });

        const seaweedMesh = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, count);

        const phases = new Float32Array(count);
        const colorVars = new Float32Array(count);
        const bladeWidths = new Float32Array(count);
        const bladeTypes = new Float32Array(count);
        const dummy = new THREE.Object3D();
        const habitatVariants = { shortGrass: 0, ribbonKelp: 0, tallAccentBlades: 0 };

        for (let i = 0; i < count; i++) {
            let sideBias = 0;
            if (Math.random() < 0.78) sideBias = Math.random() < 0.5 ? -1 : 1;
            let x;
            let z;
            if (Math.random() < 0.58) {
                ({ x, z } = sampleReefGardenPoint(spread, 1.18));
            } else {
                x = sideBias === 0
                    ? (Math.random() - 0.5) * spread * 2
                    : sideBias * randRangeLocal(OCEAN_READABILITY_ZONE.halfWidth + 10, spread);
                z = randRangeLocal(-150, 92);
            }
            ({ x, z } = this.nudgeOutOfReadabilityZone(x, z, spread));
            const y = this.getSeabedHeight(x, z);

            dummy.position.set(x, y, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            const curtainScale = Math.abs(x) > 92 || z < -95 ? 1.16 : 1.0;
            const roll = Math.random();
            const bladeType = chooseSeaweedBladeType(roll);
            const clumpScale = Math.random() < 0.58
                ? randRangeLocal(0.65, 1.0)
                : randRangeLocal(1.0, 1.4);
            if (bladeType === 0) {
                dummy.scale.set(
                    0.75 * clumpScale,
                    randRangeLocal(0.42, 0.7) * curtainScale,
                    0.75 * clumpScale,
                );
                bladeWidths[i] = randRangeLocal(0.62, 0.9);
                habitatVariants.shortGrass += 1;
            } else if (bladeType === 1) {
                dummy.scale.set(
                    1.05 * clumpScale,
                    randRangeLocal(0.72, 1.32) * curtainScale,
                    1.05 * clumpScale,
                );
                bladeWidths[i] = randRangeLocal(1.4, 2.15);
                habitatVariants.ribbonKelp += 1;
            } else {
                dummy.scale.set(
                    1.0 * clumpScale,
                    randRangeLocal(1.18, 1.72) * curtainScale,
                    1.0 * clumpScale,
                );
                bladeWidths[i] = randRangeLocal(0.78, 1.12);
                habitatVariants.tallAccentBlades += 1;
            }
            dummy.updateMatrix();
            seaweedMesh.setMatrixAt(i, dummy.matrix);

            phases[i] = Math.random() * 6.28;
            colorVars[i] = Math.random();
            bladeTypes[i] = bladeType;
        }

        seaweedMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        seaweedMesh.geometry.setAttribute(
            'aColorVar',
            new THREE.InstancedBufferAttribute(colorVars, 1),
        );
        seaweedMesh.geometry.setAttribute(
            'aBladeWidth',
            new THREE.InstancedBufferAttribute(bladeWidths, 1),
        );
        seaweedMesh.geometry.setAttribute(
            'aBladeType',
            new THREE.InstancedBufferAttribute(bladeTypes, 1),
        );
        seaweedMesh.instanceMatrix.needsUpdate = true;
        seaweedMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        seaweedMesh.computeBoundingSphere();
        if (seaweedMesh.boundingSphere) seaweedMesh.boundingSphere.radius += 6;

        this.seaweedInstances = seaweedMesh;
        this.habitatMetrics.seaweed.instances = count;
        this.habitatMetrics.seaweed.variants = habitatVariants;
        this.uniformsToUpdate.push(seaweedMesh.material.uniforms);
        this.scene.add(seaweedMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SEAGRASS MEADOW - Dense low ground-cover tufts carpeting the foreground
    // ═══════════════════════════════════════════════════════════════════════════
    createSeagrassMeadow() {
        const count = this.activePreset.seagrassCount ?? 0;
        if (count <= 0) return;

        // Upgrade clump parameters for a lush AAA look
        const segmentsPerBlade = 8;
        const bladesPerClump = 7;
        const width = 0.14;
        const height = 1.15;
        const fanAngles = [-1.2, -0.8, -0.4, 0.0, 0.4, 0.8, 1.2];
        const sCurveAmps = [-0.38, 0.26, -0.18, 0.12, -0.18, 0.26, -0.38];
        const leanAmps = [-0.22, -0.14, -0.06, 0.0, 0.06, 0.14, 0.22];

        const bladeVertices = [];
        const bladeIndices = [];
        const bladeHeights = [];

        for (let b = 0; b < bladesPerClump; b++) {
            const angle = fanAngles[b];
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const sAmp = sCurveAmps[b];
            const lean = leanAmps[b];
            const baseIdx = b * (segmentsPerBlade + 1) * 2;
            for (let s = 0; s <= segmentsPerBlade; s++) {
                const t = s / segmentsPerBlade;
                const y = t * height;
                // Organic tapering to pointed tips
                const w = width * (1.0 - t ** 1.8);
                // Full sine cycle along the blade length = S-curve. Forward bow combined
                // with horizontal sway gives the curling-frond silhouette.
                const sCurveZ = Math.sin(t * Math.PI * 2.0) * sAmp;
                const forwardBow = Math.sin(t * Math.PI) * 0.18;

                // Rotated local coordinates around clump center
                const localLeftX = -w + t * lean;
                const localRightX = w + t * lean;
                const localZ = sCurveZ + forwardBow;
                const radial = b === 3 ? 0.0 : 0.025 * Math.sign(angle);

                const lx = (localLeftX + radial) * cosA - localZ * sinA;
                const lz = (localLeftX + radial) * sinA + localZ * cosA;
                const rx = (localRightX + radial) * cosA - localZ * sinA;
                const rz = (localRightX + radial) * sinA + localZ * cosA;

                bladeVertices.push(lx, y, lz);
                bladeVertices.push(rx, y, rz);
                bladeHeights.push(t, t);
                if (s < segmentsPerBlade) {
                    const i = baseIdx + s * 2;
                    bladeIndices.push(i, i + 1, i + 2);
                    bladeIndices.push(i + 1, i + 3, i + 2);
                }
            }
        }

        const bladeGeometry = new THREE.BufferGeometry();
        bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bladeVertices, 3));
        bladeGeometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(bladeHeights, 1));
        bladeGeometry.setIndex(bladeIndices);
        bladeGeometry.computeVertexNormals();

        // Patchified placement
        const patchCenters = [
            ...OCEAN_KELP_GROVES.map((g) => ({ x: g.x, z: g.z, radius: 11 })),
            ...OCEAN_REEF_GARDENS.map((g) => ({ x: g.x, z: g.z, radius: 14 })),
            { x: -46, z: 58, radius: 9 },
            { x: 52, z: 56, radius: 9 },
            { x: -66, z: 38, radius: 10 },
            { x: 70, z: 34, radius: 10 },
        ];
        const place = () => {
            const inPatch = Math.random() < 0.86;
            let x;
            let z;
            if (inPatch) {
                const c = patchCenters[Math.floor(Math.random() * patchCenters.length)];
                const radius = Math.sqrt(Math.random()) * c.radius;
                const angle = Math.random() * Math.PI * 2;
                x = c.x + Math.cos(angle) * radius;
                z = c.z + Math.sin(angle) * radius;
            } else {
                x = (Math.random() - 0.5) * 200;
                z = randRangeLocal(-90, 80);
            }
            return this.nudgeOutOfReadabilityZone(x, z, 140);
        };

        if (this.isWebGPU) {
            const meadowMaterial = createSeagrassMeadowNodeMaterial({ currentStrength: 0.5 });
            const meadowMesh = new THREE.InstancedMesh(bladeGeometry, meadowMaterial, count);
            const phases = new Float32Array(count);
            const colorVars = new Float32Array(count);
            const dummy = new THREE.Object3D();

            for (let i = 0; i < count; i++) {
                const { x, z } = place();

                // Collision Check
                if (this.isPointOccupied(x, z, 0.8)) {
                    i--;
                    continue;
                }

                const y = this.getSeabedHeight(x, z);
                dummy.position.set(x, y + 0.02, z); // tiny lift avoids z-fighting on displaced sand
                dummy.rotation.y = Math.random() * Math.PI * 2;
                const yScale = randRangeLocal(0.7, 1.3);
                const xzScale = randRangeLocal(0.8, 1.2);
                dummy.scale.set(xzScale, yScale, xzScale);
                dummy.updateMatrix();
                meadowMesh.setMatrixAt(i, dummy.matrix);
                phases[i] = Math.random() * 6.28;
                colorVars[i] = Math.random();
            }

            meadowMesh.geometry.setAttribute(
                'aPhase',
                new THREE.InstancedBufferAttribute(phases, 1),
            );
            meadowMesh.geometry.setAttribute(
                'aColorVar',
                new THREE.InstancedBufferAttribute(colorVars, 1),
            );
            meadowMesh.instanceMatrix.needsUpdate = true;
            meadowMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
            meadowMesh.computeBoundingSphere();
            if (meadowMesh.boundingSphere) meadowMesh.boundingSphere.radius += 3;

            this.seagrassMeadowInstances = meadowMesh;
            this._tslUniforms = this._tslUniforms || [];
            this._tslUniforms.push(meadowMaterial.userData);
            this.scene.add(meadowMesh);
            return;
        }

        const bladeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCurrentStrength: { value: 0.5 },
                uFogShallow: { value: new THREE.Color().setRGB(0.05, 0.52, 0.70) },
                uFogDeep: { value: new THREE.Color().setRGB(0.02, 0.28, 0.48) },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                attribute float aHeight;
                attribute float aPhase;
                attribute float aColorVar;
                varying float vHeight;
                varying float vColorVar;
                varying float vDist;
                varying vec3 vNormal;
                varying vec2 vWorldXZ;
                varying vec3 vWorldPos;

                void main() {
                    vec3 pos = position;
                    vec4 iPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                    float h = aHeight;
                    float phase = aPhase + iPos.x * 0.03 + iPos.z * 0.025;
                    float phaseX = uTime * 1.1 + phase + h * 4.5;
                    float phaseZ = uTime * 0.88 + phase * 0.8 + h * 3.6;
                    pos.x += sin(phaseX) * h * h * uCurrentStrength * 1.1;
                    pos.z += cos(phaseZ) * h * h * uCurrentStrength * 0.77;

                    vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
                    vec4 mvPos = modelViewMatrix * worldPos;
                    vHeight = aHeight;
                    vColorVar = aColorVar;
                    vDist = length(mvPos.xyz);
                    vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
                    vWorldXZ = worldPos.xz;
                    vWorldPos = worldPos.xyz;
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vHeight;
                varying float vColorVar;
                varying float vDist;
                varying vec3 vNormal;
                varying vec2 vWorldXZ;
                varying vec3 vWorldPos;
                uniform float uTime;
                uniform vec3 uFogShallow;
                uniform vec3 uFogDeep;

                void main() {
                    // Reference organic olive green to light gold-green palette.
                    vec3 base = vec3(0.18, 0.42, 0.20);
                    vec3 mid = vec3(0.35, 0.65, 0.28);
                    vec3 tip = vec3(0.72, 0.88, 0.35);
                    vec3 color = mix(base, mid, smoothstep(0.0, 0.5, vHeight));
                    color = mix(color, tip, smoothstep(0.5, 1.0, vHeight));
                    color *= 0.85 + vColorVar * 0.3;

                    // Diffuse lighting based on normal
                    vec3 lightDir = normalize(vec3(0.16, 0.92, -0.18));
                    float diffuse = max(0.24, dot(normalize(vNormal), lightDir));
                    color *= diffuse;

                    // Subsurface Scattering (translucency) at tips
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float sssDot = clamp(dot(-viewDir, lightDir), 0.0, 1.0);
                    float sssStrength = pow(vHeight, 2.0) * sssDot * 0.38;
                    vec3 sssColor = vec3(0.4, 0.88, 0.3);
                    color += sssColor * sssStrength;

                    // Project water caustics onto seagrass blades
                    float c1 = sin(vWorldXZ.x * 0.22 + uTime * 0.7) * sin(vWorldXZ.y * 0.18 + uTime * 0.5);
                    float c2 = sin(vWorldXZ.x * 0.28 - uTime * 0.6) * sin(vWorldXZ.y * 0.24 + uTime * 0.8);
                    float caustic = pow(max(0.0, (c1 + c2) * 0.5), 3.0);
                    color += vec3(0.5, 0.96, 0.7) * caustic * 0.26 * vHeight;

                    // Depth-graded fog wash
                    float depthMix = smoothstep(-25.0, 24.0, vWorldPos.y);
                    vec3 fogColor = mix(uFogDeep, uFogShallow, depthMix);
                    float fog = 1.0 - exp(-vDist * 0.0036);
                    color = mix(color, fogColor, clamp(fog * 0.65, 0.0, 0.82));

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.DoubleSide,
        });

        const meadowMesh = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, count);
        const phases = new Float32Array(count);
        const colorVars = new Float32Array(count);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < count; i++) {
            const { x, z } = place();
            const y = this.getSeabedHeight(x, z);
            dummy.position.set(x, y + 0.02, z);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            const yScale = randRangeLocal(0.7, 1.3);
            const xzScale = randRangeLocal(0.8, 1.2);
            dummy.scale.set(xzScale, yScale, xzScale);
            dummy.updateMatrix();
            meadowMesh.setMatrixAt(i, dummy.matrix);
            phases[i] = Math.random() * 6.28;
            colorVars[i] = Math.random();
        }

        meadowMesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
        meadowMesh.geometry.setAttribute(
            'aColorVar',
            new THREE.InstancedBufferAttribute(colorVars, 1),
        );
        meadowMesh.instanceMatrix.needsUpdate = true;
        meadowMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        meadowMesh.computeBoundingSphere();
        if (meadowMesh.boundingSphere) meadowMesh.boundingSphere.radius += 3;

        this.seagrassMeadowInstances = meadowMesh;
        this.uniformsToUpdate.push(bladeMaterial.uniforms);
        this.scene.add(meadowMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CORAL REEF - Detailed colorful coral formations
    // ═══════════════════════════════════════════════════════════════════════════
    createCoralReef() {
        const count = this.activePreset.coralCount;
        const spread = 140;
        this.coralGroup = new THREE.Group();

        // Naturalistic biome palette: dusty warm sandstones + muted blue-greens.
        // The previous 8-colour candy riot read as plastic toys against the
        // graded fog; AAA reefs use 3-4 colours per zone and let lighting carry
        // the variation.
        const coralColors = [
            new THREE.Color(0xe05638), // bright warm coral red/orange
            new THREE.Color(0xffa133), // bright warm orange-yellow
            new THREE.Color(0xa855f7), // vibrant violet
            new THREE.Color(0x0ea5e9), // vibrant sky blue
            new THREE.Color(0xec4899), // vibrant pink
            new THREE.Color(0x79c782), // bright sea green
        ];

        const geometries = {
            brain: new THREE.IcosahedronGeometry(1, 2),
            branch: new THREE.CylinderGeometry(0.08, 0.15, 1, 8),
            tube: new THREE.TorusGeometry(0.4, 0.15, 8, 16),
            fan: new THREE.CircleGeometry(1, 12),
            plate: new THREE.CylinderGeometry(1.05, 0.72, 0.16, 18),
            anemone: new THREE.ConeGeometry(0.16, 1.1, 8),
            spire: new THREE.ConeGeometry(0.42, 1.35, 10),
            shell: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
        };
        const typeNames = ['brain', 'branch', 'tube', 'fan', 'plate', 'anemone', 'spire', 'shell'];
        const buckets = {};
        typeNames.forEach((typeName) => {
            buckets[typeName] = coralColors.map(() => []);
        });
        const dummy = new THREE.Object3D();
        const showcaseTerraceCount = Math.min(
            count,
            Math.max(6, Math.floor(count * 0.28)),
        );

        for (let c = 0; c < count; c++) {
            const isShowcaseTerrace = c < showcaseTerraceCount;
            let x;
            let z;
            if (isShowcaseTerrace) {
                const side = c % 2 === 0 ? -1 : 1;
                const laneT = c / Math.max(1, showcaseTerraceCount - 1);
                const garden = OCEAN_REEF_GARDENS[c % 2];
                x = side * randRangeLocal(OCEAN_READABILITY_ZONE.halfWidth + 12, Math.abs(garden.x) + 22);
                z = garden.z + Math.sin(laneT * Math.PI * 2) * 12 + randRangeLocal(-10, 10);
            } else {
                let sideBias = 0;
                if (Math.random() < 0.68) sideBias = Math.random() < 0.5 ? -1 : 1;
                if (Math.random() < 0.72) {
                    ({ x, z } = sampleReefGardenPoint(spread, 0.92));
                } else {
                    x = sideBias === 0
                        ? (Math.random() - 0.5) * spread * 2
                        : sideBias * randRangeLocal(OCEAN_READABILITY_ZONE.halfWidth + 18, spread);
                    z = randRangeLocal(-138, 76);
                }
                ({ x, z } = this.nudgeOutOfReadabilityZone(x, z, spread));
            }
            const seabedY = this.getSeabedHeight(x, z);
            const y = isShowcaseTerrace ? Math.max(seabedY, -20.5) : seabedY;
            if (!isShowcaseTerrace && y < -22) continue;

            const scale = (1.0 + Math.random() * 2.0) * (isShowcaseTerrace ? 1.28 : 1.0);
            const colorIndex = Math.floor(Math.random() * coralColors.length);
            const type = isShowcaseTerrace
                ? Math.min(0.97, 0.68 + (c % 5) * 0.06 + Math.random() * 0.035)
                : Math.random();
            this.habitatMetrics.coral.colonies += 1;
            if (isShowcaseTerrace) this.habitatMetrics.coral.showcaseTerraces += 1;

            if (type < 0.17) {
                dummy.position.set(x, y + scale * 0.8, z);
                dummy.rotation.set(0, Math.random() * Math.PI, 0);
                dummy.scale.set(scale, scale * 0.7, scale);
                dummy.updateMatrix();
                buckets.brain[colorIndex].push(dummy.matrix.clone());
                this.habitatMetrics.coral.brain += 1;
            } else if (type < 0.4) {
                const branchCount = 4 + Math.floor(Math.random() * 5);
                for (let b = 0; b < branchCount; b++) {
                    const angle = (b / branchCount) * Math.PI * 2 + Math.random() * 0.3;
                    const dist = Math.random() * scale * 0.5;
                    const bHeight = scale * (0.5 + Math.random() * 0.8);
                    dummy.position.set(
                        x + Math.cos(angle) * dist,
                        y + bHeight * 0.5,
                        z + Math.sin(angle) * dist,
                    );
                    dummy.rotation.set(
                        (Math.random() - 0.5) * 0.3,
                        angle,
                        (Math.random() - 0.5) * 0.3,
                    );
                    dummy.scale.set(scale * 0.4, bHeight, scale * 0.4);
                    dummy.updateMatrix();
                    buckets.branch[colorIndex].push(dummy.matrix.clone());
                }
                this.habitatMetrics.coral.branch += 1;
            } else if (type < 0.53) {
                dummy.position.set(x, y + scale * 0.3, z);
                dummy.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
                dummy.scale.setScalar(scale);
                dummy.updateMatrix();
                buckets.tube[colorIndex].push(dummy.matrix.clone());
                this.habitatMetrics.coral.tube += 1;
            } else if (type < 0.67) {
                dummy.position.set(x, y + scale, z);
                dummy.rotation.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.3);
                dummy.scale.setScalar(scale * 1.2);
                dummy.updateMatrix();
                buckets.fan[colorIndex].push(dummy.matrix.clone());
                this.habitatMetrics.coral.fan += 1;
            } else if (type < 0.8) {
                const shelfCount = 2 + Math.floor(Math.random() * 3);
                for (let p = 0; p < shelfCount; p++) {
                    dummy.position.set(
                        x + randRangeLocal(-0.55, 0.55) * scale,
                        y + scale * (0.34 + p * 0.2),
                        z + randRangeLocal(-0.45, 0.45) * scale,
                    );
                    dummy.rotation.set(
                        randRangeLocal(-0.1, 0.1),
                        Math.random() * Math.PI * 2,
                        randRangeLocal(-0.16, 0.16),
                    );
                    dummy.scale.set(scale * randRangeLocal(0.78, 1.35), 1, scale * randRangeLocal(0.58, 1.05));
                    dummy.updateMatrix();
                    buckets.plate[colorIndex].push(dummy.matrix.clone());
                }
                this.habitatMetrics.coral.plate += 1;
            } else if (type < 0.9) {
                const tendrilCount = 7 + Math.floor(Math.random() * 7);
                for (let a = 0; a < tendrilCount; a++) {
                    const angle = (a / tendrilCount) * Math.PI * 2 + Math.random() * 0.2;
                    const radius = randRangeLocal(0.08, 0.45) * scale;
                    dummy.position.set(
                        x + Math.cos(angle) * radius,
                        y + scale * randRangeLocal(0.18, 0.72),
                        z + Math.sin(angle) * radius,
                    );
                    dummy.rotation.set(
                        randRangeLocal(-0.34, 0.34),
                        angle,
                        randRangeLocal(-0.22, 0.22),
                    );
                    dummy.scale.set(scale * 0.42, scale * randRangeLocal(0.55, 1.15), scale * 0.42);
                    dummy.updateMatrix();
                    buckets.anemone[colorIndex].push(dummy.matrix.clone());
                }
                this.habitatMetrics.coral.anemone += 1;
            } else if (type < 0.96) {
                const spireCount = 3 + Math.floor(Math.random() * 4);
                for (let s = 0; s < spireCount; s++) {
                    const angle = (s / spireCount) * Math.PI * 2 + Math.random() * 0.25;
                    const radius = randRangeLocal(0.08, 0.5) * scale;
                    dummy.position.set(
                        x + Math.cos(angle) * radius,
                        y + scale * randRangeLocal(0.45, 0.86),
                        z + Math.sin(angle) * radius,
                    );
                    dummy.rotation.set(randRangeLocal(-0.18, 0.18), angle, randRangeLocal(-0.12, 0.12));
                    dummy.scale.set(scale * 0.55, scale * randRangeLocal(0.8, 1.45), scale * 0.55);
                    dummy.updateMatrix();
                    buckets.spire[colorIndex].push(dummy.matrix.clone());
                }
                this.habitatMetrics.coral.spire += 1;
            } else {
                dummy.position.set(x, y + scale * 0.16, z);
                dummy.rotation.set(
                    randRangeLocal(-0.12, 0.12),
                    Math.random() * Math.PI * 2,
                    randRangeLocal(-0.08, 0.08),
                );
                dummy.scale.set(
                    scale * randRangeLocal(0.7, 1.2),
                    scale * 0.32,
                    scale * randRangeLocal(0.56, 0.96),
                );
                dummy.updateMatrix();
                buckets.shell[colorIndex].push(dummy.matrix.clone());
                this.habitatMetrics.coral.shell += 1;
            }
        }

        typeNames.forEach((typeName) => {
            buckets[typeName].forEach((matrices, colorIndex) => {
                if (matrices.length === 0) return;
                let material;
                if (this.isWebGPU) {
                    material = createCoralNodeMaterial(coralColors[colorIndex]);
                    this._tslUniforms = this._tslUniforms || [];
                    this._tslUniforms.push(material.userData);
                } else {
                    material = new THREE.MeshLambertMaterial({
                        color: coralColors[colorIndex],
                        emissive: coralColors[colorIndex].clone().multiplyScalar(0.2),
                        emissiveIntensity: 0.44,
                        side: THREE.DoubleSide,
                    });
                }
                const mesh = new THREE.InstancedMesh(
                    geometries[typeName].clone(),
                    material,
                    matrices.length,
                );
                matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
                mesh.instanceMatrix.needsUpdate = true;
                this.coralGroup.add(mesh);
            });
        });
        typeNames.forEach((typeName) => geometries[typeName].dispose());

        this.scene.add(this.coralGroup);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FISH SCHOOLS - Procedural instanced fish with schooling behavior
    // ═══════════════════════════════════════════════════════════════════════════
    createFishSchools() {
        this.fishSystem = new OceanFishSystem({
            scene: this.scene,
            camera: this.camera,
            preset: this.activePreset,
            getSeabedHeight: this.getSeabedHeight.bind(this),
            isPointOccupied: this.isPointOccupied.bind(this),
            isWebGPU: this.isWebGPU,
        });
        this.fishSystem.init();
    }

    createReefDwellers() {
        const count = this.activePreset.reefDwellerCount;
        if (!count || count <= 0) return;

        // Collect anchors
        const anchors = [];

        // 1. Coral Group children
        const dummyMatrix = new THREE.Matrix4();
        const dummyPos = new THREE.Vector3();
        this.coralGroup?.children.forEach((c) => {
            if (c.isInstancedMesh) {
                for (let i = 0; i < c.count; i++) {
                    c.getMatrixAt(i, dummyMatrix);
                    dummyPos.setFromMatrixPosition(dummyMatrix);
                    anchors.push(dummyPos.clone());
                }
            } else if (c.position) {
                anchors.push(c.position.clone());
            }
        });

        // 2. Atmosphere foreground rocks
        this.atmosphereSystem?.foregroundRocks?.forEach((r) => {
            if (r.position) anchors.push(r.position.clone());
        });

        // 3. Hero corals
        this.atmosphereSystem?.heroCorals?.forEach((c) => {
            if (c && c.position) anchors.push(c.position.clone());
        });

        // 4. Coral carpet patches
        this.atmosphereSystem?.coralCarpetPatches?.forEach((c) => {
            if (c && c.position) anchors.push(c.position.clone());
        });

        if (!anchors.length) return;

        // Shuffle anchors to ensure even distribution across the reef
        for (let i = anchors.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [anchors[i], anchors[j]] = [anchors[j], anchors[i]];
        }

        let qualityTier = 3;
        const q = this.currentQuality;
        if (q === 'Minimal') qualityTier = 0;
        else if (q === 'Low') qualityTier = 1;
        else if (q === 'Medium') qualityTier = 2;
        else if (q === 'High') qualityTier = 3;
        else if (q === 'Ultra') qualityTier = 4;
        else if (q === 'Extreme') qualityTier = 5;

        this.reefDwellerSystem = new OceanReefDwellerSystem({
            scene: this.scene,
            totalCount: count,
            qualityTier,
            isWebGPU: this.isWebGPU,
            getSeabedHeight: this.getSeabedHeight.bind(this),
            isPointOccupied: this.isPointOccupied.bind(this),
            getFishSystem: () => this.fishSystem,
        });

        this.reefDwellerSystem.init(anchors);
    }

    createRareFauna() {
        this.rareFaunaSystem = new OceanRareFaunaSystem({
            scene: this.scene,
            camera: this.camera,
            preset: this.activePreset,
            quality: this.currentQuality,
            getSeabedHeight: this.getSeabedHeight.bind(this),
            isPointOccupied: this.isPointOccupied.bind(this),
            getFishSystem: () => this.fishSystem,
            getCamera: () => this.oceanCamera,
            getGameplayEffects: () => this.gameplayEffects,
        });
        this.rareFaunaSystem.init();
    }

    createGameplayEffects() {
        this.gameplayEffects = new OceanGameplayEffects({
            scene: this.scene,
            camera: this.camera,
            preset: this.activePreset,
            quality: this.currentQuality,
            isWebGPU: this.isWebGPU,
            getSeabedHeight: this.getSeabedHeight.bind(this),
            getPost: () => this.oceanPost,
            getFishSystem: () => this.fishSystem,
            getCamera: () => this.oceanCamera,
        });
        this.gameplayEffects.init();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // JELLYFISH - Glowing soft circular creatures
    // ═══════════════════════════════════════════════════════════════════════════
    createJellyfish() {
        const count = this.activePreset.jellyfishCount;
        const jellyColors = [
            new THREE.Color(0x7ff7ff),
            new THREE.Color(0x58f0c8),
            new THREE.Color(0xb18cff),
            new THREE.Color(0xff9b75),
        ];

        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            let sideBias = 0;
            if (Math.random() < 0.62) sideBias = Math.random() < 0.5 ? -1 : 1;
            positions[i * 3] = sideBias === 0 ? randRangeLocal(-95, 95) : sideBias * randRangeLocal(36, 128);
            positions[i * 3 + 1] = 18 + Math.random() * 42;
            positions[i * 3 + 2] = randRangeLocal(-120, 54);

            const c = jellyColors[Math.floor(Math.random() * jellyColors.length)];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;

            phases[i] = Math.random() * 6.28;
            sizes[i] = 8 + Math.random() * 13;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        if (this.isWebGPU) {
            geometry.dispose();
            const billboardGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            billboardGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
            billboardGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
            billboardGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
            const material = createJellyfishNodeMaterial();
            this.jellyfishMesh = new THREE.InstancedMesh(billboardGeometry, material, count);
            this.jellyfishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            // WS 1.2: wrap-domain sphere so frustum culling kicks in when the
            // camera looks away from the field. Jellyfish span ±128 X / ±120 Z.
            billboardGeometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(0, 35, -30),
                220,
            );
            this.jellyfishMesh.frustumCulled = true;
            this.jellyfishMesh.userData.primitive = 'billboard-quad';
            this.jellyfishData = { positions, phases, count };
            this._tslUniforms = this._tslUniforms || [];
            this._tslUniforms.push(material.userData);
            this.scene.add(this.jellyfishMesh);
            return;
        }

        const material = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `
                uniform float uTime;
                attribute vec3 aColor;
                attribute float aPhase;
                attribute float aSize;
                varying vec3 vColor;
                varying float vPulse;
                
                void main() {
                    vec3 pos = position;
                    pos.y += sin(uTime * 0.38 + aPhase) * 2.2;
                    pos.x += sin(uTime * 0.18 + aPhase * 1.3) * 1.35;
                    pos.z += cos(uTime * 0.22 + aPhase * 0.8) * 1.1;
                    
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    vColor = aColor;
                    vPulse = sin(uTime * 1.8 + aPhase) * 0.25 + 0.75;
                    
                    gl_PointSize = aSize * vPulse * (220.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vPulse;
                
                void main() {
                    // Smooth circular glow (not squared!)
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    
                    // Soft dome shape
                    float alpha = pow(1.0 - d, 1.8) * vPulse;
                    vec3 color = vColor * (0.6 + vPulse * 0.5);
                    
                    // Bright glowing center
                    color += vec3(0.82, 1.0, 0.92) * pow(1.0 - d, 5.0) * 0.34;
                    
                    gl_FragColor = vec4(color, alpha * 0.5);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.jellyfishMesh = new THREE.Points(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.jellyfishMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PLANKTON - Bioluminescent soft circular particles
    // ═══════════════════════════════════════════════════════════════════════════
    createPlankton() {
        const count = this.activePreset.planktonCount;

        const positions = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            let x;
            let z;
            if (Math.random() < 0.64) {
                ({ x, z } = sampleReefGardenPoint(160, randRangeLocal(0.7, 1.45)));
            } else {
                x = randRangeLocal(-160, 160);
                z = randRangeLocal(-155, 85);
            }
            const nearReef = Math.random() < 0.58;
            positions[i * 3] = x;
            positions[i * 3 + 1] = nearReef
                ? this.getSeabedHeight(x, z) + randRangeLocal(4, 28)
                : Math.random() * 70 + 5;
            positions[i * 3 + 2] = z;
            phases[i] = Math.random() * 6.28;
            sizes[i] = nearReef ? randRangeLocal(0.48, 1.55) : randRangeLocal(0.42, 1.9);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        if (this.isWebGPU) {
            geometry.dispose();
            const billboardGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            billboardGeometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
            billboardGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
            const material = createPlanktonNodeMaterial({ glowIntensity: 0.66 });
            this.planktonMesh = new THREE.InstancedMesh(billboardGeometry, material, count);
            this.planktonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            // WS 1.2: plankton spans ±160 X / -155..85 Z, height up to 75.
            billboardGeometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(0, 40, -35),
                250,
            );
            this.planktonMesh.frustumCulled = true;
            this.planktonMesh.userData.primitive = 'billboard-quad';
            this.planktonData = { positions, phases, count };
            this._tslUniforms = this._tslUniforms || [];
            this._tslUniforms.push(material.userData);
            this.scene.add(this.planktonMesh);
            return;
        }

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCurrentStrength: { value: 0.5 },
                uGlowIntensity: { value: 0.66 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                uniform float uGlowIntensity;
                attribute float aPhase;
                attribute float aSize;
                varying float vGlow;
                varying float vDist;
                
                void main() {
                    vec3 pos = position;
                    pos.y += sin(uTime * 0.14 + aPhase) * 0.45;
                    pos.x += sin(uTime * 0.1 + aPhase * 1.2) * (0.52 + uCurrentStrength * 0.26);
                    pos.z += cos(uTime * 0.11 + aPhase * 0.9) * (0.42 + uCurrentStrength * 0.18);
                    
                    vGlow = sin(uTime * 0.72 + aPhase * 3.5) * 0.5 + 0.5;
                    vGlow *= uGlowIntensity * 0.32;
                    
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    vDist = length(mvPos.xyz);
                    gl_PointSize = (aSize + vGlow * 0.9) * (128.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vGlow;
                varying float vDist;
                
                void main() {
                    // Smooth circular glow (not squared!)
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    
                    float alpha = pow(1.0 - d, 2.8);
                    vec3 color = mix(vec3(0.015, 0.12, 0.14), vec3(0.11, 0.44, 0.38), vGlow);
                    float fog = 1.0 - exp(-vDist * 0.009);
                    color = mix(color, vec3(0.0, 0.15, 0.18), fog * 0.7);
                    
                    gl_FragColor = vec4(color, alpha * (0.045 + vGlow * 0.16) * (1.0 - fog * 0.32));
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.planktonMesh = new THREE.Points(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.planktonMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUBBLES - Shader-driven rising bubble columns
    // ═══════════════════════════════════════════════════════════════════════════
    createBubbles() {
        const count = this.activePreset.bubbleCount;
        const columnCount = Math.max(5, Math.round(Math.sqrt(count) * 0.62));
        const columns = [];

        for (let c = 0; c < columnCount; c++) {
            let sideBias = 0;
            if (Math.random() < 0.66) sideBias = Math.random() < 0.5 ? -1 : 1;
            let x;
            let z;
            if (Math.random() < 0.62) {
                ({ x, z } = sampleReefGardenPoint(120, 0.72));
            } else {
                x = sideBias === 0 ? randRangeLocal(-70, 70) : sideBias * randRangeLocal(28, 105);
                z = randRangeLocal(-120, 70);
            }
            ({ x, z } = this.nudgeOutOfReadabilityZone(x, z, 120));
            columns.push({
                x,
                z,
                y: this.getSeabedHeight(x, z) + randRangeLocal(0.8, 2.5),
                spread: randRangeLocal(0.7, 3.6),
            });
        }

        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);
        const lifeOffsets = new Float32Array(count);
        const columnSpread = new Float32Array(count);
        const micro = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const column = columns[i % columnCount];
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * column.spread;
            const isMicro = Math.random() < 0.72;
            positions[i * 3] = column.x + Math.cos(angle) * radius;
            positions[i * 3 + 1] = column.y;
            positions[i * 3 + 2] = column.z + Math.sin(angle) * radius;
            speeds[i] = isMicro ? randRangeLocal(0.72, 1.65) : randRangeLocal(0.38, 0.9);
            phases[i] = Math.random() * 6.28;
            sizes[i] = isMicro ? randRangeLocal(0.55, 1.65) : randRangeLocal(1.8, 4.2);
            lifeOffsets[i] = Math.random();
            columnSpread[i] = column.spread;
            micro[i] = isMicro ? 1 : 0;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLifeOffset', new THREE.BufferAttribute(lifeOffsets, 1));
        geometry.setAttribute('aColumnSpread', new THREE.BufferAttribute(columnSpread, 1));
        geometry.setAttribute('aMicro', new THREE.BufferAttribute(micro, 1));

        if (this.isWebGPU) {
            geometry.dispose();
            // ── WebGPU vertex-buffer packing ──
            // WebGPU limits pipelines to 8 vertex buffers. PlaneGeometry provides
            // position + normal + uv (3), plus instanceMatrix (1) = 4 base slots.
            // Packing the 6 per-instance floats into 2 buffers (vec4 + vec2) keeps
            // the total at 4 + 2 = 6, well within the limit.
            const pack1 = new Float32Array(count * 4); // speed, phase, size, lifeOffset
            const pack2 = new Float32Array(count * 2); // columnSpread, micro
            for (let i = 0; i < count; i++) {
                pack1[i * 4] = speeds[i];
                pack1[i * 4 + 1] = phases[i];
                pack1[i * 4 + 2] = sizes[i];
                pack1[i * 4 + 3] = lifeOffsets[i];
                pack2[i * 2] = columnSpread[i];
                pack2[i * 2 + 1] = micro[i];
            }
            const billboardGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
            billboardGeometry.setAttribute('aBubblePack1', new THREE.InstancedBufferAttribute(pack1, 4));
            billboardGeometry.setAttribute('aBubblePack2', new THREE.InstancedBufferAttribute(pack2, 2));
            const material = createBubbleNodeMaterial();
            this.bubbleMesh = new THREE.InstancedMesh(billboardGeometry, material, count);
            this.bubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            // WS 1.2: bubbles rise from columns ±105 X / -120..70 Z up to ~70m.
            billboardGeometry.boundingSphere = new THREE.Sphere(
                new THREE.Vector3(0, 35, -25),
                200,
            );
            this.bubbleMesh.frustumCulled = true;
            this.bubbleMesh.userData.primitive = 'billboard-quad';
            this.bubbleBillboardData = {
                positions,
                speeds,
                phases,
                lifeOffsets,
                columnSpread,
                count,
            };
            this._tslUniforms = this._tslUniforms || [];
            this._tslUniforms.push(material.userData);
            this.scene.add(this.bubbleMesh);
            return;
        }

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uCurrentStrength: { value: 0.5 },
                uGlowIntensity: { value: 0.8 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uCurrentStrength;
                uniform float uGlowIntensity;
                attribute float aSpeed;
                attribute float aPhase;
                attribute float aSize;
                attribute float aLifeOffset;
                attribute float aColumnSpread;
                attribute float aMicro;
                varying float vAlpha;
                varying float vRing;
                varying float vDist;
                varying float vMicro;
                
                void main() {
                    vec3 pos = position;
                    float travel = fract(aLifeOffset + uTime * aSpeed * 0.035);
                    float rise = travel * 98.0;
                    float drift = aColumnSpread * (0.12 + travel * 0.26) * (1.0 + uCurrentStrength * 0.16);

                    pos.y += rise;
                    pos.x += sin(uTime * 1.35 + aPhase + travel * 6.0) * drift + travel * uCurrentStrength * 0.9;
                    pos.z += cos(uTime * 1.2 + aPhase * 1.3 + travel * 5.0) * drift * 0.8;
                    
                    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
                    float fadeIn = smoothstep(0.0, 0.12, travel);
                    float fadeOut = 1.0 - smoothstep(0.78, 1.0, travel);
                    vAlpha = fadeIn * fadeOut * (0.22 + uGlowIntensity * 0.055);
                    vRing = 0.78 + sin(aPhase) * 0.08;
                    vDist = length(mvPos.xyz);
                    vMicro = aMicro;
                    
                    gl_PointSize = aSize * (112.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                varying float vRing;
                varying float vDist;
                varying float vMicro;
                
                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    if (d > 1.0) discard;
                    
                    float shell = smoothstep(vRing - 0.12, vRing, d)
                        * (1.0 - smoothstep(vRing, 1.0, d));
                    float innerGlass = (1.0 - smoothstep(0.0, vRing - 0.15, d)) * 0.08;
                    float microCore = (1.0 - smoothstep(0.0, 0.62, d)) * vMicro * 0.3;
                    vec2 highlightPos = gl_PointCoord - vec2(0.32, 0.28);
                    float highlight = 1.0 - smoothstep(0.0, 0.18, length(highlightPos));
                    float lowerGleam = 1.0 - smoothstep(0.0, 0.34, length(gl_PointCoord - vec2(0.62, 0.72)));

                    vec3 color = vec3(0.38, 0.72, 0.88) * (shell + innerGlass + microCore);
                    color += vec3(0.72, 0.9, 0.92) * highlight * 0.24;
                    color += vec3(0.14, 0.52, 0.66) * lowerGleam * 0.08;

                    float fog = 1.0 - exp(-vDist * 0.011);
                    color = mix(color, vec3(0.0, 0.1, 0.14), fog * 0.64);
                    
                    float alpha = (shell * 0.44 + innerGlass * 0.72 + highlight * 0.12 + microCore * 0.7) * vAlpha;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.bubbleMesh = new THREE.Points(geometry, material);
        this.uniformsToUpdate.push(material.uniforms);
        this.scene.add(this.bubbleMesh);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LIGHTING
    // ═══════════════════════════════════════════════════════════════════════════
    createLighting() {
        // Daylit reef but with restored shadow contrast — between the
        // original moody navy and the flat-washed daylight overshoot.
        // Ambient softer (so sand floor doesn't blow out), directional sun
        // moderate (so corals cast definition), hemisphere modest. The
        // overall scene still reads bright/tropical but with depth.
        const ambient = new THREE.AmbientLight(0x5a96b0, 0.42);
        this.scene.add(ambient);

        const directional = new THREE.DirectionalLight(0xfff0d0, 1.0);
        directional.position.set(18, 100, -18);
        this.scene.add(directional);

        const hemisphere = new THREE.HemisphereLight(0x9ed4e0, 0x2c5a78, 0.4);
        this.scene.add(hemisphere);

        const foregroundFill = new THREE.PointLight(0x6fc8d4, 0.3, 160, 2.0);
        foregroundFill.position.set(-34, 20, 48);
        this.scene.add(foregroundFill);

        const reefWarmth = new THREE.PointLight(0xffc890, 0.28, 115, 2.2);
        reefWarmth.position.set(54, 8, -34);
        this.scene.add(reefWarmth);
    }

    isNodeMaterial(material) {
        if (!material) return false;
        if (material.isNodeMaterial) return true;
        if (
            material.isMeshBasicNodeMaterial
            || material.isMeshStandardNodeMaterial
            || material.isMeshPhysicalNodeMaterial
            || material.isMeshPhongNodeMaterial
        ) {
            return true;
        }
        const type = material.type || material.constructor?.name || '';
        return type.includes('NodeMaterial');
    }

    ensureMrtMaterials() {
        if (!this.isWebGPU || !this.scene) return;

        const seen = new Set();
        const patched = [];
        const nonNode = [];
        const zeroEmissive = vec3(0.0, 0.0, 0.0);

        const recordMaterial = (material, object) => {
            if (!material) return;
            if (Array.isArray(material)) {
                material.forEach((mat) => recordMaterial(mat, object));
                return;
            }
            if (seen.has(material)) return;
            seen.add(material);

            if (!this.isNodeMaterial(material)) {
                const name = object?.name || object?.type || 'UnknownObject';
                nonNode.push(name);

                // CRITICAL FIX: If we are on the WebGPU path, any legacy ShaderMaterial
                // will crash the TSL-based PostProcessing. We hide them as a last resort.
                if (material.isShaderMaterial || material.type === 'ShaderMaterial') {
                    console.warn(`\uD83C\uDF0A [Ocean] Hiding incompatible ShaderMaterial object: ${name}`);
                    object.visible = false;
                }
                return;
            }

            if (!material.emissiveNode) {
                material.emissiveNode = zeroEmissive;
                patched.push(
                    material.name || material.type || material.constructor?.name || 'NodeMaterial',
                );
            }
            material.mrtNode = mrt({ emissive: material.emissiveNode || zeroEmissive });
            material.needsUpdate = true;
        };

        this.scene.traverse((child) => {
            if (child.material) recordMaterial(child.material, child);
        });

        if (patched.length && !this._oceanMrtWarned) {
            console.log('🌊 [Ocean] Patched MRT emissiveNode on materials:', patched);
        }
        if (nonNode.length && !this._oceanMrtWarned) {
            console.warn(
                '🌊 [Ocean] Non-NodeMaterials remain on WebGPU path:',
                nonNode.slice(0, 8),
            );
        }
        this._oceanMrtWarned = true;
    }

    setupPostProcessing() {
        const post = this.activePreset?.postProcessing;
        const postEnabled = post?.postProcessingEnabled ?? (post?.bloom || post?.grade);
        if (this.isWebGPU && postEnabled) {
            // WebGPU TSL pipeline
            try {
                const preset = this.activePreset ?? {};
                const dofOn = preset.dofEnabled === true;
                this.oceanPost = new OceanPost(this.renderer, this.scene, this.camera, {
                    useMRT: true,
                    bloomStrength: post.bloom ? (post.bloomStrength ?? 0.1) : 0.0,
                    bloomRadius: post.bloomRadius ?? 0.5,
                    bloomThreshold: post.bloomThreshold ?? 0.85,
                    bloomScale: post.bloomScale ?? 0.6,
                    sceneScale: post.sceneScale ?? 1.0,
                    gradeStrength: post.grade ? (post.gradeStrength ?? 0.92) : 0.0,
                    // Tighter vignette + moodier exposure + denser atmospheric fog
                    // push the scene toward the reference photo's deeper-saturated,
                    // stronger-god-ray-contrast underwater look.
                    vignetteDarkness: post.vignette ?? 0.42,
                    // Prefer top-level preset values from plan; fall back to atmosphere subobject for back-compat.
                    shaftStrength: preset.shaftStrength ?? preset.atmosphere?.rayStrength ?? 0.0,
                    shaftSamples: preset.godRaySamples ?? preset.atmosphere?.rayCount ?? 8,
                    chromaStrength: preset.chromaticEdge ?? 0.0,
                    chromaticAberrationEnabled:
                        QUALITY_EFFECT_LIMITS[this.currentQuality]?.chromaticAberration === true,
                    refractionEnabled: preset.refractionEnabled === true,
                    refractionStrength: preset.refractionEnabled === true ? 0.34 : 0.0,
                    dofStrength: dofOn ? 0.82 : 0.0,
                    dofMaxRadius: dofOn ? 0.0016 : 0.0,
                    dofDeadZone: dofOn ? 0.035 : 1.0,
                    focalDepth: 0.08,
                    fogDensity: 0.52,
                    exposure: 0.78,
                });
                this.oceanPost.enabled = true;
                this._applyPostDebugFlags();
                this.oceanPost.setSize?.(window.innerWidth, window.innerHeight);
                console.log('\uD83C\uDF0A [Ocean] WebGPU TSL post-processing initialized', {
                    chroma: preset.chromaticEdge ?? 0,
                    dof: dofOn,
                    shafts: preset.godRaySamples,
                    sceneScale: post.sceneScale ?? 1.0,
                    bloomScale: post.bloomScale ?? 0.6,
                });
            } catch (err) {
                console.warn(
                    '\uD83C\uDF0A [Ocean] TSL post init failed, using direct WebGPU render:',
                    err,
                );
                this.oceanPost = null;
            }
        } else {
            this.setupLegacyPost();
        }
    }

    setupLegacyPost() {
        this.oceanPost = new OceanPostProcessingLegacy({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            preset: this.activePreset,
        });
        this.oceanPost.init();
        this._applyPostDebugFlags();
    }

    // Apply post-effect debug flags by zeroing the corresponding TSL uniforms
    // after OceanPost is constructed. Each flag is cheap (one uniform write) so
    // we can compare effects with/without by reloading. Bloom flag also goes
    // through updateParams since it's a node uniform.
    _applyPostDebugFlags() {
        if (!this.oceanPost) return;
        if (this.flags.noGodRays && this.oceanPost.uShaftStrength) {
            this.oceanPost.uShaftStrength.value = 0;
        }
        if (this.flags.noDof && this.oceanPost.uDofStrength) {
            this.oceanPost.uDofStrength.value = 0;
        }
        if (this.flags.noRefraction && this.oceanPost.uRefractionStrength) {
            this.oceanPost.uRefractionStrength.value = 0;
        }
        if (this.flags.noChroma) {
            if (this.oceanPost.uChromaStrength) this.oceanPost.uChromaStrength.value = 0;
            this.oceanPost.chromaticAberrationEnabled = false;
            this.oceanPost.baseChromaStrength = 0;
        }
        if (this.flags.noGrade && this.oceanPost.uGradeStrength) {
            this.oceanPost.uGradeStrength.value = 0;
        }
        if (this.flags.noVignette && this.oceanPost.uVignetteDarkness) {
            this.oceanPost.uVignetteDarkness.value = 0;
        }
        if (this.flags.noBloom && this.oceanPost.updateParams) {
            this.oceanPost.updateParams({ bloomStrength: 0 });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT LISTENERS
    // ═══════════════════════════════════════════════════════════════════════════
    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.targetCurrentStrength = Math.min(
                    2.5,
                    this.currentStrength + data.lineCount * 0.35,
                );
                this.targetGlowIntensity = Math.min(
                    1.5,
                    this.glowIntensity + data.lineCount * 0.18,
                );
                this.gameplayEffects?.triggerLineClear?.(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (
                this.isActive
                && settings?.backgroundComboEffects !== false
                && data.comboCount > 1
            ) {
                this.targetCurrentStrength = Math.min(
                    3.5,
                    this.currentStrength + data.comboCount * 0.45,
                );
                this.targetGlowIntensity = Math.min(
                    2.0,
                    this.glowIntensity + data.comboCount * 0.22,
                );
                this.gameplayEffects?.triggerCombo?.(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects !== false) {
                this.gameplayEffects?.triggerPieceLock?.(data);
            }
        });

        const pointerMoveHandler = (e) => {
            if (this.oceanCamera && this.isActive) {
                const targetX = (e.clientX / window.innerWidth) * 2 - 1;
                const targetY = -(e.clientY / window.innerHeight) * 2 + 1;
                this.oceanCamera.setPointer(targetX, targetY);
            }
        };

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);

        const resizeHandler = () => this.handleResize();
        window.addEventListener('resize', resizeHandler);
        window.addEventListener('pointermove', pointerMoveHandler);
        this.eventUnsubscribers.push(() => {
            window.removeEventListener('resize', resizeHandler);
            window.removeEventListener('pointermove', pointerMoveHandler);
        });
    }

    handleResize() {
        if (!this.renderer || !this.camera) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        if (this.oceanPost?.setSize) {
            this.oceanPost.setSize(w, h);
        } else if (this.oceanPost?.resize) {
            this.oceanPost.resize(w, h);
        }
    }

    setBillboardInstance(mesh, index, x, y, z) {
        if (!mesh || !this.camera || !this.billboardDummy) return;
        this.billboardDummy.position.set(x, y, z);
        this.billboardDummy.quaternion.copy(this.camera.quaternion);
        this.billboardDummy.scale.setScalar(1);
        this.billboardDummy.updateMatrix();
        mesh.setMatrixAt(index, this.billboardDummy.matrix);
    }

    updateOceanBillboards(time, phase = -1) {
        if (!this.isWebGPU || !this.camera) return;
        this.camera.updateMatrixWorld();

        // Debug skip flags fully suppress the per-population update path even
        // when the mesh still exists in the scene — lets us measure pure CPU
        // cost vs. draw-call cost separately.
        const doJellyfish = (phase === -1 || phase === 0) && !this.flags?.noJellyfish;
        const doPlankton = (phase === -1 || phase === 1) && !this.flags?.noPlankton;
        const doBubbles = (phase === -1 || phase === 2) && !this.flags?.noBubbles;

        if (doJellyfish && this.jellyfishMesh && this.jellyfishData) {
            const { positions, phases, count } = this.jellyfishData;
            for (let i = 0; i < count; i += 1) {
                const i3 = i * 3;
                const ph = phases[i];
                this.setBillboardInstance(
                    this.jellyfishMesh,
                    i,
                    positions[i3] + Math.sin(time * 0.18 + ph * 1.3) * 1.35,
                    positions[i3 + 1] + Math.sin(time * 0.38 + ph) * 2.2,
                    positions[i3 + 2] + Math.sin(time * 0.22 + ph * 0.8) * 1.1,
                );
            }
            this.jellyfishMesh.instanceMatrix.needsUpdate = true;
        }

        if (doPlankton && this.planktonMesh && this.planktonData) {
            const { positions, phases, count } = this.planktonData;
            for (let i = 0; i < count; i += 1) {
                const i3 = i * 3;
                const ph = phases[i];
                this.setBillboardInstance(
                    this.planktonMesh,
                    i,
                    positions[i3]
                    + Math.sin(time * 0.1 + ph * 1.2) * (0.52 + this.currentStrength * 0.26),
                    positions[i3 + 1] + Math.sin(time * 0.14 + ph) * 0.45,
                    positions[i3 + 2]
                    + Math.sin(time * 0.11 + ph * 0.9) * (0.42 + this.currentStrength * 0.18),
                );
            }
            this.planktonMesh.instanceMatrix.needsUpdate = true;
        }

        if (doBubbles && this.bubbleMesh && this.bubbleBillboardData) {
            const {
                positions, speeds, phases, lifeOffsets, columnSpread, count,
            } = this.bubbleBillboardData;
            for (let i = 0; i < count; i += 1) {
                const i3 = i * 3;
                const ph = phases[i];
                const travel = (lifeOffsets[i] + time * speeds[i] * 0.035) % 1;
                const drift = columnSpread[i] * (0.12 + travel * 0.26) * (1 + this.currentStrength * 0.16);
                this.setBillboardInstance(
                    this.bubbleMesh,
                    i,
                    positions[i3]
                    + Math.sin(time * 1.35 + ph + travel * 6.0) * drift
                    + travel * this.currentStrength * 0.9,
                    positions[i3 + 1] + travel * 98.0,
                    positions[i3 + 2]
                    + Math.sin(time * 1.2 + ph * 1.3 + travel * 5.0) * drift * 0.8,
                );
            }
            this.bubbleMesh.instanceMatrix.needsUpdate = true;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANIMATION LOOP
    // ═══════════════════════════════════════════════════════════════════════════
    startAnimation() {
        // Create camera state machine on first run
        if (!this.oceanCamera && this.camera) {
            this.oceanCamera = new OceanCamera(this.camera);
        }

        // Phase D.5: install the diagnostic surface. window.oceanDebug.report()
        // dumps a snapshot to console; .bisect() runs the auto-bisection. We
        // bind to `this` so the methods survive arrow-function re-entry.
        if (typeof window !== 'undefined') {
            window.oceanDebug = {
                report: () => this.debugReport(),
                bisect: (opts) => this.runBisection(opts),
                listFlags: () => OCEAN_DEBUG_FLAGS.map(([k]) => k),
                getTheme: () => this,
                getSpikes: () => (window.perfMonitor?.getSpikes?.() ?? []),
                clearSpikes: () => window.perfMonitor?.clearSpikes?.(),
            };
            // Phase J: tag every detected frame-time spike with ocean-side
            // context — the most likely culprits for spike frames are async
            // GLB upgrade tasks completing or active bisect transitions.
            // Calling this is cheap (just reads existing fields).
            if (typeof window.perfMonitor?.setSpikeContextCollector === 'function') {
                window.perfMonitor.setSpikeContextCollector(() => ({
                    atmUpgradesPending: this.atmosphereSystem
                        ? (this.atmosphereSystem.assetUpgradeTimers?.length ?? 0)
                          + (this.atmosphereSystem.upgradeQueue?.length ?? 0)
                          + (this.atmosphereSystem.upgradeQueueRunning ? 1 : 0)
                        : 0,
                    bisectRunning: !!this._bisectRunning,
                    bisectScenario: window.__oceanBisectStatus?.name || null,
                    preset: Object.entries(this.qualityPresets || {})
                        .find(([, v]) => v === this.activePreset)?.[0] || 'unknown',
                }));
            }
            // Auto-fire when ?oceanBisect=... is present. We check the URL
            // directly here (not this.flags.bisect) because the param value
            // can be a scope string like 'all' or 'atmosphere', and the
            // boolean-flag reader only treats '1'/'true'/'yes'/'on' as truthy.
            // Delay 4 s so the scene fully populates (deferred construction
            // queue, GLB loads) before we start sampling — otherwise baseline
            // is contaminated by spawn cost.
            const params = new URLSearchParams(window.location.search);
            const bisectRaw = params.get('oceanBisect') ?? params.get('bisect');
            if (bisectRaw !== null && !this._bisectAutoFired) {
                this._bisectAutoFired = true;
                const lower = (bisectRaw || '1').toLowerCase();
                const validScopes = new Set(['broad', 'atmosphere', 'fauna', 'post', 'render', 'all']);
                const scope = validScopes.has(lower) ? lower : 'broad';
                // eslint-disable-next-line no-console
                console.log(`🔬 [ocean-bisect] auto-fire armed (scope='${scope}'); starting in 4 s...`);
                setTimeout(() => this.runBisection({ scope }), 4000);
            }
        }

        const loop = () => {
            if (!this.isActive) return;

            const delta = Math.min(this.clock.getDelta(), 0.033);
            const time = this.clock.elapsedTime;
            this.trackSignoffFrame(delta);
            const perf = typeof window !== 'undefined' ? window.perfMonitor : null;

            // Stride flags: even-frame group runs reef dwellers + hero asset
            // layer + ocean billboards; odd-frame group runs atmosphere
            // billboards. Spreads ~2,700 instance-matrix uploads/frame at
            // Extreme across two frames so neither frame doubles up.
            // ?oceanNoStriding=1 forces every subsystem to run every frame so
            // we can A/B-compare WS 1.3 striding's actual savings.
            this.frameCount += 1;
            let evenHeavy = (this.frameCount % 2) === 0;
            let oddHeavy = !evenHeavy;
            if (this.flags.noStriding) {
                evenHeavy = true;
                oddHeavy = true;
            }
            this._strideDtAccum.evenHeavy += delta;
            this._strideDtAccum.oddHeavy += delta;
            const evenHeavyDt = evenHeavy ? this._strideDtAccum.evenHeavy : 0;
            if (evenHeavy) this._strideDtAccum.evenHeavy = 0;
            if (oddHeavy) this._strideDtAccum.oddHeavy = 0;

            // Smooth transitions
            this.currentStrength += (this.targetCurrentStrength - this.currentStrength) * 0.018;
            this.targetCurrentStrength += (0.5 - this.targetCurrentStrength) * 0.006;
            this.glowIntensity += (this.targetGlowIntensity - this.glowIntensity) * 0.022;
            this.targetGlowIntensity += (0.8 - this.targetGlowIntensity) * 0.008;

            // WS 1.4: skip broadcasting non-time uniforms when their smoothed
            // source values haven't shifted meaningfully. `currentStrength` and
            // `glowIntensity` dampen to constants (0.5 / 0.8) and stay flat
            // for long stretches; ~60 redundant uniform sets/frame go away.
            const lastBroadcast = this._lastUniformBroadcast || (this._lastUniformBroadcast = {
                currentStrength: Number.NaN,
                glowIntensity: Number.NaN,
            });
            const strengthChanged = Math.abs(this.currentStrength - lastBroadcast.currentStrength) > 1e-4;
            const glowChanged = Math.abs(this.glowIntensity - lastBroadcast.glowIntensity) > 1e-4;
            if (strengthChanged) lastBroadcast.currentStrength = this.currentStrength;
            if (glowChanged) lastBroadcast.glowIntensity = this.glowIntensity;
            const waveIntensity = strengthChanged ? 1.0 + this.currentStrength * 0.3 : 0;

            // Update all registered legacy uniforms (WebGL path)
            this.uniformsToUpdate.forEach((u) => {
                if (u.uTime) u.uTime.value = time;
                if (strengthChanged) {
                    if (u.uCurrentStrength) u.uCurrentStrength.value = this.currentStrength;
                    if (u.uWaveIntensity) u.uWaveIntensity.value = waveIntensity;
                }
                if (glowChanged) {
                    if (u.uIntensity) u.uIntensity.value = this.glowIntensity;
                    if (u.uGlowIntensity) u.uGlowIntensity.value = this.glowIntensity;
                }
            });

            // Update TSL uniforms (WebGPU path)
            if (this._tslUniforms) {
                this._tslUniforms.forEach((u) => {
                    if (u.uTime) u.uTime.value = time;
                    if (strengthChanged && u.uCurrentStrength) u.uCurrentStrength.value = this.currentStrength;
                    if (glowChanged && u.uGlowIntensity) u.uGlowIntensity.value = this.glowIntensity;
                });
            }

            if (!this.flags.noFish) {
                perf?.startSection('ocean.fish');
                this.fishSystem?.update(delta, time, {
                    currentStrength: this.currentStrength,
                    glowIntensity: this.glowIntensity,
                    heroHeavyTick: evenHeavy,
                    heroHeavyDt: evenHeavyDt,
                    skipHeroAssets: this.flags.noHeroAssets,
                });
                perf?.endSection('ocean.fish');
            }
            if (!this.flags.noDwellers) {
                perf?.startSection('ocean.dwellers');
                this.reefDwellerSystem?.update(delta, time, {
                    currentStrength: this.currentStrength,
                    heavyTick: evenHeavy,
                    heavyDt: evenHeavyDt,
                });
                perf?.endSection('ocean.dwellers');
            }
            if (!this.flags.noAtmosphere) {
                perf?.startSection('ocean.atmosphere');
                this.atmosphereSystem?.update(time, {
                    currentStrength: this.currentStrength,
                    glowIntensity: this.glowIntensity,
                    billboardHeavyTick: oddHeavy,
                    skipBillboards: this.flags.noAtmosphereBillboards,
                });
                perf?.endSection('ocean.atmosphere');
            }

            let gameplayState = null;
            if (!this.flags.noGameplayFx) {
                perf?.startSection('ocean.gameplayFx');
                gameplayState = this.gameplayEffects?.update(delta, time);
                perf?.endSection('ocean.gameplayFx');
            }
            if (gameplayState) {
                this.targetCurrentStrength = Math.max(
                    this.targetCurrentStrength,
                    0.5 + gameplayState.currentBoost,
                );
                this.targetGlowIntensity = Math.max(
                    this.targetGlowIntensity,
                    0.8 + gameplayState.glowBoost,
                );
            }
            const rareFaunaGameplayIntensity = Math.max(
                gameplayState?.currentBoost ?? 0,
                gameplayState?.glowBoost ?? 0,
            );
            if (!this.flags.noRareFauna) {
                perf?.startSection('ocean.rareFauna');
                this.rareFaunaSystem?.update(delta, time, {
                    currentStrength: this.currentStrength,
                    glowIntensity: this.glowIntensity,
                    gameplayIntensity: rareFaunaGameplayIntensity,
                });
                perf?.endSection('ocean.rareFauna');
            }

            // Camera: use state machine if available, else legacy drift
            if (this.oceanCamera) {
                const heroFishVisible = this.fishSystem?.hasHeroFishInView?.() === true;
                const cameraState = this.oceanCamera.update(delta, time, {
                    heroFishVisible,
                    godRaysVisibleUpper: this.activePreset?.shaftStrength > 0,
                });
                if (cameraState?.focalDepth !== undefined && this.oceanPost?.updateParams) {
                    this.oceanPost.updateParams({ focalDepth: cameraState.focalDepth });
                }
            } else {
                // Legacy camera drift fallback
                const drift1 = Math.sin(time * 0.05) * 8;
                const drift2 = Math.sin(time * 0.08 + 1.5) * 4;
                const drift3 = Math.cos(time * 0.03) * 6;
                this.camera.position.x = drift1 + Math.sin(time * 0.12) * 2;
                this.camera.position.y = 22 + Math.sin(time * 0.07) * 4 + Math.sin(time * 0.15) * 1.5;
                this.camera.position.z = 75 + drift3 * 0.5 + Math.sin(time * 0.06) * 3;
                const lookX = drift2 * 0.4 + Math.sin(time * 0.04) * 3;
                const lookY = 8 + Math.sin(time * 0.06) * 3;
                const lookZ = -10 + Math.cos(time * 0.05) * 5;
                this.camera.lookAt(lookX, lookY, lookZ);
                this.camera.rotation.z = Math.sin(time * 0.04) * 0.015;
            }

            // Ocean billboards round-robin across 3 frames (~20 Hz per population):
            // jellyfish on N%3==0, plankton on N%3==1, bubbles on N%3==2. Spreads
            // ~1,258 matrix uploads/frame at Ultra into ~420 per frame.
            // ?oceanNoStriding=1 collapses to phase=-1 (all three every frame).
            if (!this.flags.noBillboards) {
                perf?.startSection('ocean.billboards');
                const billboardPhase = this.flags.noStriding ? -1 : (this.frameCount % 3);
                this.updateOceanBillboards(time, billboardPhase);
                perf?.endSection('ocean.billboards');
            }

            perf?.startSection('ocean.post');
            if (this.oceanPost?.enabled) {
                if (this.oceanPost.updateTime) this.oceanPost.updateTime(time);
                this.oceanPost.render(time, this.glowIntensity);
            } else {
                this.renderer.render(this.scene, this.camera);
            }
            perf?.endSection('ocean.post');

            // Phase D.1: surface renderer.info to the overlay so we can see
            // ground-truth draw calls / triangles / geometries / textures /
            // programs live. Reset counters for the next frame.
            const info = this.renderer?.info;
            if (info && perf?.recordCounters) {
                perf.recordCounters({
                    calls: info.render?.calls ?? 0,
                    triangles: info.render?.triangles ?? 0,
                    geometries: info.memory?.geometries ?? 0,
                    textures: info.memory?.textures ?? 0,
                    programs: info.programs?.length ?? 0,
                });
                if (typeof info.reset === 'function') info.reset();
            }

            this.animationFrameId = requestAnimationFrame(loop);
        };

        this.animationFrameId = requestAnimationFrame(loop);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE D — DIAGNOSTIC TOOLKIT
    // Build a structured snapshot of theme state for the user to paste into
    // a bug report, plus an auto-bisection runner that cycles through major
    // subsystem disables and records FPS per config. Both surfaces are wired
    // to window.oceanDebug (installed in startAnimation).
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * One-shot diagnostic dump. Pastes a JSON-ish block into the console with
     * everything we'd ask for in a perf bug report: quality preset, active
     * flags, renderer.info, perfMonitor sections, frame-time percentiles.
     */
    debugReport() {
        const pm = (typeof window !== 'undefined' && window.perfMonitor) || null;
        const counters = pm?.getCounters?.() || null;
        const percentiles = pm?.getPercentiles?.() || null;
        const sections = pm?.getAllSections?.() || null;
        const metrics = pm?.getMetrics?.() || null;
        const activeFlags = Object.entries(this.flags || {})
            .filter(([, v]) => v)
            .map(([k]) => k);
        const presetKey = Object.entries(this.qualityPresets || {})
            .find(([, v]) => v === this.activePreset)?.[0] || 'unknown';
        const report = {
            theme: 'ocean',
            preset: presetKey,
            renderer: this.isWebGPU ? 'webgpu' : 'webgl',
            activeFlags,
            metrics: metrics ? {
                fps: metrics.fps?.toFixed?.(1),
                avgFPS: metrics.avgFPS?.toFixed?.(1),
                frameTime: metrics.frameTime?.toFixed?.(2),
                avgFrameTime: metrics.avgFrameTime?.toFixed?.(2),
            } : null,
            percentiles: percentiles ? {
                p50: percentiles.p50?.toFixed?.(2),
                p95: percentiles.p95?.toFixed?.(2),
                p99: percentiles.p99?.toFixed?.(2),
            } : null,
            renderInfo: counters ? {
                calls: counters.callsAvg?.toFixed?.(0),
                triangles: counters.trianglesAvg?.toFixed?.(0),
                geometries: counters.geometries,
                textures: counters.textures,
                programs: counters.programs,
            } : null,
            sections,
        };
        // eslint-disable-next-line no-console
        console.group('🌊 [ocean-debug] report');
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(report, null, 2));
        // eslint-disable-next-line no-console
        console.groupEnd();
        return report;
    }

    /**
     * Build the list of bisection scenarios. Each scenario has apply()/restore()
     * that hide or show the relevant root meshes / disable subsystems. Returning
     * functions (not just flag toggles) means we don't have to teach the
     * animation loop new branches — we toggle visibility on real Object3Ds
     * which immediately removes their render cost.
     *
     * `scope` selects which subset runs:
     *   'broad'      — 8 system-level scenarios (default; ~60 s)
     *   'atmosphere' — drill into atmosphere sub-groups; useful when 'broad'
     *                  showed noAtmosphere as the worst offender
     *   'fauna'      — drill into fauna sub-systems (fish, dwellers, rare,
     *                  jellyfish, plankton, bubbles, hero fish); useful when
     *                  'broad' showed noFauna as a meaningful gainer
     *   'post'       — drill into the post chain: bloom, god rays, DOF, etc.
     *                  via TSL uniform writes (the same path `_applyPostDebugFlags`
     *                  uses), so each component is isolated without rebuilding.
     *   'render'     — render-side fillrate diagnostic (half-res pixel ratio)
     *   'all'        — broad + atmosphere + fauna + post + render (~5 min, thorough)
     */
    _buildBisectScenarios(scope = 'broad') {
        const scenarios = [];
        const noop = () => {};
        const visibilityToggle = (objs) => {
            const real = objs.filter(Boolean);
            const prev = real.map((o) => o.visible);
            return {
                apply: () => real.forEach((o) => { o.visible = false; }),
                restore: () => real.forEach((o, i) => { o.visible = prev[i]; }),
            };
        };
        // Toggle a TSL uniform (.value-style) off and back. Used for post-chain
        // breakdown — bloom/godrays/DOF/etc. all read uniforms each frame so
        // zeroing them removes the cost without rebuilding the post graph.
        const uniformToggle = (uni, valueWhenOff = 0) => {
            if (!uni) return { apply: noop, restore: noop };
            let prev;
            return {
                apply: () => { prev = uni.value; uni.value = valueWhenOff; },
                restore: () => { if (prev !== undefined) uni.value = prev; },
            };
        };

        const includeBroad = scope === 'broad' || scope === 'all';
        const includeAtmosphere = scope === 'atmosphere' || scope === 'all';
        const includeFauna = scope === 'fauna' || scope === 'all';
        const includePost = scope === 'post' || scope === 'all';
        const includeRender = scope === 'render' || scope === 'all';

        if (includeBroad) scenarios.push({ name: 'baseline (all on)', apply: noop, restore: noop });

        if (includeBroad) {
            // Post chain off — falls back to direct renderer.render via the
            // existing animation-loop branch when this.oceanPost.enabled is false.
            scenarios.push({
                name: 'noPost (skip bloom + god rays + DOF + chroma + grade)',
                ...(this.oceanPost ? {
                    apply: () => { this.oceanPost._wasEnabled = this.oceanPost.enabled; this.oceanPost.enabled = false; },
                    restore: () => { this.oceanPost.enabled = this.oceanPost._wasEnabled ?? true; },
                } : { apply: noop, restore: noop }),
            });

            scenarios.push({
                name: 'noAtmosphere (hero kelp/coral/reef + haze + dust + glow + silhouettes + carpets)',
                ...visibilityToggle([this.atmosphereSystem?.group]),
            });

            scenarios.push({
                name: 'noSeabed',
                ...visibilityToggle([this.seabedMesh]),
            });

            scenarios.push({
                name: 'noWater (surface plane above scene)',
                ...visibilityToggle([this.waterSurface]),
            });

            scenarios.push({
                name: 'noSeaweed + noSeagrass',
                ...visibilityToggle([this.seaweedInstances, this.seagrassInstances]),
            });

            scenarios.push({
                name: 'noFauna (fish + dwellers + rare + jellyfish + plankton + bubbles)',
                ...visibilityToggle([
                    ...(this.fishSystem?.meshes || []),
                    ...(this.reefDwellerSystem?.meshes?.map((m) => m.mesh) || []),
                    ...(this.rareFaunaSystem?.activeCreatures?.map((c) => c.group) || []),
                    this.jellyfishMesh,
                    this.planktonMesh,
                    this.bubbleMesh,
                ]),
            });

            // Aggregate scenarios — total cost-of-category numbers. If
            // 'noAllParticleClouds' is much bigger than the sum of individual
            // jelly/plankton/bubble scenarios, transparent overdraw is the
            // shared cost driver and we should attack it as a class (soft
            // particles, depth-fade, or fewer concurrent transparents).
            scenarios.push({
                name: 'noAllParticleClouds (jelly + plankton + bubbles, transparent overdraw)',
                ...visibilityToggle([this.jellyfishMesh, this.planktonMesh, this.bubbleMesh]),
            });
            const atmAgg = this.atmosphereSystem;
            scenarios.push({
                name: 'noAllVegetation (seaweed + seagrass + coral overgrowth + carpets)',
                ...visibilityToggle([
                    this.seaweedInstances,
                    this.seagrassInstances,
                    ...(atmAgg?.coralOvergrowthInstances || []),
                    ...(atmAgg?.coralCarpetPatches || []),
                ]),
            });
            scenarios.push({
                name: 'noAllHeroGLBs (kelp + corals + reef walls + carpets + foreground rocks + imported seabed)',
                ...visibilityToggle([
                    ...(atmAgg?.heroKelp || []),
                    ...(atmAgg?.heroCorals || []),
                    ...(atmAgg?.heroReefWalls || []),
                    ...(atmAgg?.coralCarpetPatches || []),
                    ...(atmAgg?.foregroundRocks || []),
                    ...(atmAgg?.importedSeabedDetails || []),
                ]),
            });

            // All-off — strips everything except whatever scene-clear remains.
            // If FPS is still bad here, the issue is the renderer/post baseline.
            const allObjs = [
                this.atmosphereSystem?.group,
                this.seabedMesh,
                this.waterSurface,
                this.seaweedInstances,
                this.seagrassInstances,
                this.jellyfishMesh,
                this.planktonMesh,
                this.bubbleMesh,
                ...(this.fishSystem?.meshes || []),
                ...(this.reefDwellerSystem?.meshes?.map((m) => m.mesh) || []),
                ...(this.rareFaunaSystem?.activeCreatures?.map((c) => c.group) || []),
            ];
            scenarios.push({
                name: 'all-off (only post + clear)',
                ...visibilityToggle(allObjs),
            });
        }

        // Atmosphere drill-down — pinpoints which sub-group inside the
        // atmosphere is responsible for cost. Run with scope:'atmosphere' after
        // 'broad' shows noAtmosphere as the worst offender. Each scenario
        // hides one set of atmosphere meshes while everything else stays on.
        if (includeAtmosphere) {
            const atm = this.atmosphereSystem;
            if (!atm) {
                // eslint-disable-next-line no-console
                console.warn('🔬 [ocean-bisect] atmosphere scope requested but atmosphereSystem is null');
            } else {
                scenarios.push({ name: 'atm: baseline (atmosphere fully on)', apply: noop, restore: noop });
                scenarios.push({
                    name: 'atm: noHeroKelp (hero kelp GLB clones)',
                    ...visibilityToggle(atm.heroKelp || []),
                });
                scenarios.push({
                    name: 'atm: noHeroCorals (hero coral GLB clones)',
                    ...visibilityToggle(atm.heroCorals || []),
                });
                scenarios.push({
                    name: 'atm: noHeroReefWalls (procedural/GLB reef walls)',
                    ...visibilityToggle(atm.heroReefWalls || []),
                });
                scenarios.push({
                    name: 'atm: noCoralOvergrowth (consolidated coral on rocks)',
                    ...visibilityToggle(atm.coralOvergrowthInstances || []),
                });
                scenarios.push({
                    name: 'atm: noForegroundRocks (procedural + GLB rocks)',
                    ...visibilityToggle(atm.foregroundRocks || []),
                });
                scenarios.push({
                    name: 'atm: noImportedSeabedDetails (imported GLB seabed extras)',
                    ...visibilityToggle(atm.importedSeabedDetails || []),
                });
                scenarios.push({
                    name: 'atm: noBillboards (glow + dust)',
                    ...visibilityToggle([atm.glowBillboardMesh, atm.dustBillboardMesh]),
                });
                scenarios.push({
                    name: 'atm: noCoralCarpets (decorative coral patches on seabed)',
                    ...visibilityToggle(atm.coralCarpetPatches || []),
                });
                scenarios.push({
                    name: 'atm: noHaze (volumetric haze layer planes)',
                    ...visibilityToggle(atm.hazeLayers || []),
                });
                scenarios.push({
                    name: 'atm: noReefSilhouettes (variant-bucketed background rocks)',
                    ...visibilityToggle(atm.reefSilhouettes || []),
                });
                scenarios.push({
                    name: 'atm: noBiomeSilhouettes (distant kelp-curtain parallax planes)',
                    ...visibilityToggle(atm.biomeSilhouettes || []),
                });
                scenarios.push({
                    name: 'atm: noArches (silhouette arch InstancedMesh)',
                    ...visibilityToggle(atm.arches || []),
                });
            }
        }

        // Fauna drill-down — splits the broad noFauna scenario into its
        // sub-systems so we can see whether jellyfish overdraw, plankton
        // particle counts, fish boids, or rare-fauna GLBs own the cost.
        if (includeFauna) {
            scenarios.push({ name: 'fauna: baseline (all fauna on)', apply: noop, restore: noop });
            scenarios.push({
                name: 'fauna: noFishSchools (procedural school fish — 4 species InstancedMesh)',
                ...visibilityToggle(this.fishSystem?.meshes || []),
            });
            scenarios.push({
                name: 'fauna: noHeroFish (GLB hero fish clones)',
                ...visibilityToggle(
                    (this.fishSystem?.heroAssetCreatures || []).map((c) => c.group),
                ),
            });
            scenarios.push({
                name: 'fauna: noDwellers (reef-anchored fish + seahorse clones)',
                ...visibilityToggle([
                    ...(this.reefDwellerSystem?.meshes || []).map((m) => m.mesh),
                    ...(this.reefDwellerSystem?.seahorseClones || []).map((sh) => sh.group),
                ]),
            });
            scenarios.push({
                name: 'fauna: noRareFauna (sharks/turtles/whales/manta/dolphin GLBs)',
                ...visibilityToggle(
                    (this.rareFaunaSystem?.activeCreatures || []).map((c) => c.group),
                ),
            });
            scenarios.push({
                name: 'fauna: noJellyfish (additive-blended billboard cloud)',
                ...visibilityToggle([this.jellyfishMesh]),
            });
            scenarios.push({
                name: 'fauna: noPlankton (additive-blended billboard cloud)',
                ...visibilityToggle([this.planktonMesh]),
            });
            scenarios.push({
                name: 'fauna: noBubbles (additive-blended billboard cloud)',
                ...visibilityToggle([this.bubbleMesh]),
            });
        }

        // Post-chain breakdown — isolates each effect via TSL uniform writes.
        // Same mechanism as _applyPostDebugFlags() so behaviour matches the
        // URL flags exactly. Runs in scope:'post' or 'all'.
        if (includePost && this.oceanPost) {
            const post = this.oceanPost;
            scenarios.push({ name: 'post: baseline (post fully on)', apply: noop, restore: noop });
            scenarios.push({
                name: 'post: noBloom (zero bloom strength)',
                ...(post.updateParams ? (() => {
                    let prev;
                    return {
                        apply: () => { prev = post.bloomNode?.strength?.value; post.updateParams({ bloomStrength: 0 }); },
                        restore: () => { if (prev !== undefined) post.updateParams({ bloomStrength: prev }); },
                    };
                })() : { apply: noop, restore: noop }),
            });
            scenarios.push({
                name: 'post: noGodRays (zero shaft strength)',
                ...uniformToggle(post.uShaftStrength),
            });
            scenarios.push({
                name: 'post: noDof (zero DOF strength)',
                ...uniformToggle(post.uDofStrength),
            });
            scenarios.push({
                name: 'post: noChroma (zero chromatic aberration)',
                ...uniformToggle(post.uChromaStrength),
            });
            scenarios.push({
                name: 'post: noGrade (zero grade strength)',
                ...uniformToggle(post.uGradeStrength),
            });
            scenarios.push({
                name: 'post: noVignette (zero vignette darkness)',
                ...uniformToggle(post.uVignetteDarkness),
            });
            scenarios.push({
                name: 'post: noRefraction (zero refraction strength)',
                ...uniformToggle(post.uRefractionStrength),
            });
        }

        // Render-side diagnostics — tell us whether the GPU is fillrate-
        // bound (lots of pixels) vs. compute/draw-call bound (CPU + shader
        // complexity). If render:halfRes nearly doubles FPS, we're fillrate-
        // bound and the answer is render-scale / resolution-scale cuts. If
        // halfRes gives little gain, GPU work per pixel is fine and the
        // bottleneck is elsewhere (CPU, draw call submission, etc.).
        if (includeRender && this.renderer) {
            const r = this.renderer;
            scenarios.push({ name: 'render: baseline (current pixel ratio)', apply: noop, restore: noop });
            scenarios.push({
                name: 'render: halfRes (pixel ratio × 0.5 — tests fillrate)',
                ...(() => {
                    let prev;
                    return {
                        apply: () => {
                            prev = r.getPixelRatio?.() ?? 1;
                            r.setPixelRatio?.(prev * 0.5);
                            // Re-trigger size update so render targets match the new ratio.
                            const size = new THREE.Vector2();
                            r.getSize?.(size);
                            r.setSize?.(size.x, size.y, false);
                        },
                        restore: () => {
                            if (prev === undefined) return;
                            r.setPixelRatio?.(prev);
                            const size = new THREE.Vector2();
                            r.getSize?.(size);
                            r.setSize?.(size.x, size.y, false);
                        },
                    };
                })(),
            });
        }

        return scenarios;
    }

    /**
     * Run the bisection sequence. Each scenario runs for SAMPLE_MS; between
     * scenarios there's a warmup so the avgFPS / percentile rolling buffers
     * settle on the new state before we sample.
     */
    runBisection({
        sampleMs = 6000, warmupMs = 1500, scope = 'broad', maxReadyWaitMs = 30000,
    } = {}) {
        if (this._bisectRunning) {
            // eslint-disable-next-line no-console
            console.warn('🔬 [ocean-bisect] already running — ignored');
            return;
        }
        const pm = (typeof window !== 'undefined' && window.perfMonitor) || null;
        if (!pm) {
            // eslint-disable-next-line no-console
            console.warn('🔬 [ocean-bisect] window.perfMonitor missing; press F3 first to enable monitoring');
            return;
        }
        // Bisect needs the monitor sampling. If the user didn't press F3 we
        // auto-start it (avgFPS / percentiles are zero otherwise).
        if (typeof pm.start === 'function') pm.start();
        // Suppress the perfMonitor's adaptive-downscale watchdog during the
        // run — otherwise the scene's render scale drops mid-bisect and each
        // scenario gets measured at a different effective resolution, making
        // the comparison meaningless.
        if (typeof pm.setAdaptiveDownscaleSuppressed === 'function') {
            pm.setAdaptiveDownscaleSuppressed(true);
        }
        const scenarios = this._buildBisectScenarios(scope);
        if (!scenarios.length) {
            // eslint-disable-next-line no-console
            console.warn(`🔬 [ocean-bisect] no scenarios for scope='${scope}' — try 'broad' | 'atmosphere' | 'fauna' | 'post' | 'render' | 'all'`);
            return;
        }
        this._bisectRunning = true;
        const results = [];
        let idx = 0;

        const totalSecPerScenario = (sampleMs + warmupMs) / 1000;
        const totalSec = Math.ceil(scenarios.length * totalSecPerScenario);
        const startedAt = performance.now();

        const finish = () => {
            this._bisectRunning = false;
            if (typeof window !== 'undefined') window.__oceanBisectStatus = null;
            // Sort by FPS gain vs baseline (descending) so the heaviest
            // subsystem floats to the top of the table.
            const baseline = results.find((r) => r.name.startsWith('baseline'));
            const baseFps = baseline?.fps ?? 0;
            const enriched = results.map((r) => ({
                ...r,
                deltaFps: baseFps ? +(r.fps - baseFps).toFixed(1) : 0,
            }));
            const sorted = [...enriched].sort((a, b) => b.deltaFps - a.deltaFps);
            // eslint-disable-next-line no-console
            console.group('🌊 [ocean-bisect] results — sorted by FPS gain vs baseline');
            // eslint-disable-next-line no-console
            console.table(sorted);
            // eslint-disable-next-line no-console
            console.log('Biggest cost: the row with the highest +deltaFps is the system to attack.');
            // eslint-disable-next-line no-console
            console.groupEnd();
        };

        const runNext = () => {
            if (idx >= scenarios.length) { finish(); return; }
            const sc = scenarios[idx];
            idx += 1;
            sc.apply();
            // Publish live status so the F3 overlay can show progress without
            // the user needing to keep the console open.
            if (typeof window !== 'undefined') {
                const elapsedSec = (performance.now() - startedAt) / 1000;
                const etaSec = Math.max(0, Math.round(totalSec - elapsedSec));
                window.__oceanBisectStatus = {
                    idx,
                    total: scenarios.length,
                    name: sc.name,
                    etaSec,
                    scope,
                };
            }
            // eslint-disable-next-line no-console
            console.log(`🔬 [ocean-bisect] (${idx}/${scenarios.length}) ${sc.name}`);
            setTimeout(() => {
                // Sample after warmup so the rolling FPS window settles.
                const m = pm.getMetrics?.() || {};
                const perc = pm.getPercentiles?.() || {};
                const counters = pm.getCounters?.() || {};
                results.push({
                    name: sc.name,
                    fps: +(m.avgFPS || 0).toFixed(1),
                    frameP50: +(perc.p50 || 0).toFixed(2),
                    frameP95: +(perc.p95 || 0).toFixed(2),
                    calls: Math.round(counters.callsAvg || 0),
                    tris: Math.round(counters.trianglesAvg || 0),
                });
                sc.restore();
                // Brief gap so visibility flips settle before next config.
                setTimeout(runNext, 100);
            }, sampleMs + warmupMs);
        };

        // Phase D.3 v2: don't start scenarios until the scene is fully
        // constructed AND FPS has stabilized. Without this, the first ~10
        // scenarios measure during async GLB loads + JIT warmup, producing
        // 30-50% lower readings than the warmed state and nonsensical
        // negative deltas. Polls every 500 ms for:
        //   1) atmosphereSystem.isSceneReady() — all asset upgrade timers
        //      fired + upgrade queue drained
        //   2) avgFPS settled for 3 consecutive seconds (variance < 5 fps)
        // Falls back to starting after maxReadyWaitMs even if not ready.
        const waitForReady = (onReady) => {
            const startedAtReady = performance.now();
            let stableFor = 0;
            let lastAvg = -1;
            const poll = () => {
                const elapsed = performance.now() - startedAtReady;
                const sceneReady = this.atmosphereSystem?.isSceneReady?.() !== false;
                const metrics = pm.getMetrics?.() || {};
                const avg = metrics.avgFPS ?? 0;
                const isSettled = sceneReady && avg > 1 && Math.abs(avg - lastAvg) < 5;
                if (isSettled) {
                    stableFor += 500;
                    if (stableFor >= 3000) {
                        // eslint-disable-next-line no-console
                        console.log(`🔬 [ocean-bisect] scene ready after ${(elapsed / 1000).toFixed(1)}s (avgFPS ${avg.toFixed(1)}, scene loaded). Starting scenarios.`);
                        onReady();
                        return;
                    }
                } else {
                    stableFor = 0;
                }
                lastAvg = avg;
                if (elapsed >= maxReadyWaitMs) {
                    // eslint-disable-next-line no-console
                    console.warn(`🔬 [ocean-bisect] readiness timeout after ${(elapsed / 1000).toFixed(1)}s (sceneReady=${sceneReady}, avgFPS=${avg.toFixed(1)}) — starting anyway. Data may be noisy.`);
                    onReady();
                    return;
                }
                setTimeout(poll, 500);
            };
            // eslint-disable-next-line no-console
            console.log(`🔬 [ocean-bisect] scope='${scope}': ${scenarios.length} scenarios × ${totalSecPerScenario}s each (~${totalSec}s after warmup). Waiting up to ${maxReadyWaitMs / 1000}s for scene to fully load + FPS to stabilize before scenarios begin. Keep the tab focused — progress is in the F3 overlay.`);
            // Publish a placeholder status so the overlay shows we're waiting.
            if (typeof window !== 'undefined') {
                window.__oceanBisectStatus = {
                    idx: 0,
                    total: scenarios.length,
                    name: 'waiting for scene ready + FPS stable...',
                    etaSec: Math.round(maxReadyWaitMs / 1000),
                    scope,
                };
            }
            poll();
        };

        waitForReady(runNext);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════════════════
    stop() {
        this.uninstallSignoffHelper();

        this.eventUnsubscribers.forEach((unsub) => {
            if (typeof unsub === 'function') unsub();
        });
        this.eventUnsubscribers = [];

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Cancel any pending deferred build steps.
        this._sceneBuildToken = (this._sceneBuildToken || 0) + 1;

        this.teardownQualityListener();
        this.disposeSceneContents();

        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }

        this.scene = null;
        this.camera = null;
        this.uniformsToUpdate = [];
        this._tslUniforms = null;
        this.fishSystem = null;
        this.reefDwellerSystem = null;
        this.rareFaunaSystem = null;
        this.gameplayEffects = null;
        this.atmosphereSystem = null;
        this.oceanPost = null;
        this.oceanCamera = null;
        this.jellyfishData = null;
        this.planktonData = null;
        this.bubbleBillboardData = null;
        this.bubbleData = null;
        this.resetHabitatMetrics();
        this.signoffFrameTimes = [];

        const container = document.getElementById('ocean-theme');
        if (container) container.innerHTML = '';

        super.stop();
    }
}
