export const SKY_V2_QUALITY_PRESETS = Object.freeze({
    mobile: Object.freeze({
        tier: 'mobile',
        label: 'Mobile',
        renderScale: 0.62,
        terrainSegments: 112,
        mountainMeshes: 4,
        cloudClusters: 6,
        cloudPuffsPerCluster: 3,
        grassNearCount: 9200,
        grassMidCount: 8400,
        flowerAnchorCount: 840,
        flowerAnchorMin: 360,
        flowerCarpetCoverageTarget: 0.06,
        flowerHeadsCount: 2400,
        flowerStemsCount: 3000,
        flowerGroundLiftHead: 0.66,
        flowerGroundLiftStem: 0.34,
        flowerWhiteShareMax: 0.1,
        flowerAnchorCellSize: 10,
        flowerCarpetStrength: 0.92,
        flowerFarTintStrength: 0.2,
        flowerNearCount: 2400,
        flowerRibbonDensity: 0.92,
        farCoverageStrength: 0.38,
        grassInstances: 4200,
        flowerInstances: 2400,
        fogDensity: 0.0010,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.65,
            bloomRadius: 0.85,
            bloomThreshold: 0.65,
            exposure: 1.05,
            contrast: 1.1,
            saturation: 1.2,
            vignetteDarkness: 0.18,
            grainStrength: 0.003,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.56,
        adaptiveMaxScale: 0.72,
        adaptiveDownRate: 0.035,
        adaptiveUpRate: 0.018,
    }),
    medium: Object.freeze({
        tier: 'medium',
        label: 'Medium',
        renderScale: 0.82,
        terrainSegments: 156,
        mountainMeshes: 6,
        cloudClusters: 10,
        cloudPuffsPerCluster: 4,
        grassNearCount: 22400,
        grassMidCount: 18200,
        flowerAnchorCount: 1600,
        flowerAnchorMin: 620,
        flowerCarpetCoverageTarget: 0.08,
        flowerHeadsCount: 4400,
        flowerStemsCount: 5600,
        flowerGroundLiftHead: 0.66,
        flowerGroundLiftStem: 0.34,
        flowerWhiteShareMax: 0.1,
        flowerAnchorCellSize: 8,
        flowerCarpetStrength: 1.0,
        flowerFarTintStrength: 0.32,
        flowerNearCount: 4400,
        flowerRibbonDensity: 1.05,
        farCoverageStrength: 0.46,
        grassInstances: 12400,
        flowerInstances: 4400,
        fogDensity: 0.0008,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.75,
            bloomRadius: 0.95,
            bloomThreshold: 0.6,
            exposure: 1.08,
            contrast: 1.12,
            saturation: 1.25,
            vignetteDarkness: 0.22,
            grainStrength: 0.0034,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.64,
        adaptiveMaxScale: 0.9,
        adaptiveDownRate: 0.032,
        adaptiveUpRate: 0.019,
    }),
    high: Object.freeze({
        tier: 'high',
        label: 'High',
        renderScale: 1.0,
        terrainSegments: 224,
        mountainMeshes: 8,
        cloudClusters: 12,
        cloudPuffsPerCluster: 4,
        grassNearCount: 48000,
        grassMidCount: 38200,
        flowerAnchorCount: 3400,
        flowerAnchorMin: 1400,
        flowerCarpetCoverageTarget: 0.10,
        flowerHeadsCount: 8400,
        flowerStemsCount: 10500,
        flowerGroundLiftHead: 0.66,
        flowerGroundLiftStem: 0.34,
        flowerWhiteShareMax: 0.1,
        flowerAnchorCellSize: 7,
        flowerCarpetStrength: 1.12,
        flowerFarTintStrength: 0.46,
        flowerNearCount: 8400,
        flowerRibbonDensity: 1.3,
        farCoverageStrength: 0.58,
        grassInstances: 24200,
        flowerInstances: 8400,
        fogDensity: 0.0006,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.85,
            bloomRadius: 1.1,
            bloomThreshold: 0.55,
            exposure: 1.1,
            contrast: 1.15,
            saturation: 1.3,
            vignetteDarkness: 0.26,
            grainStrength: 0.0038,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.72,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.03,
        adaptiveUpRate: 0.02,
    }),
    ultra: Object.freeze({
        tier: 'ultra',
        label: 'Ultra',
        renderScale: 1.0,
        terrainSegments: 280,
        mountainMeshes: 10,
        cloudClusters: 20,
        cloudPuffsPerCluster: 7,
        grassNearCount: 86000,
        grassMidCount: 68000,
        flowerAnchorCount: 4800,
        flowerAnchorMin: 2400,
        flowerCarpetCoverageTarget: 0.11,
        flowerHeadsCount: 12000,
        flowerStemsCount: 15000,
        flowerGroundLiftHead: 0.68,
        flowerGroundLiftStem: 0.36,
        flowerWhiteShareMax: 0.1,
        flowerAnchorCellSize: 6,
        flowerCarpetStrength: 1.3,
        flowerFarTintStrength: 0.58,
        flowerNearCount: 12000,
        flowerRibbonDensity: 1.45,
        farCoverageStrength: 0.68,
        grassInstances: 38000,
        flowerInstances: 12000,
        fogDensity: 0.0005,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 1.0,
            bloomRadius: 1.25,
            bloomThreshold: 0.5,
            exposure: 1.15,
            contrast: 1.2,
            saturation: 1.35,
            vignetteDarkness: 0.28,
            grainStrength: 0.004,
        }),
        targetFrameMs: 16.7,
        adaptiveMinScale: 0.8,
        adaptiveMaxScale: 1.0,
        adaptiveDownRate: 0.028,
        adaptiveUpRate: 0.021,
    }),
});

const SKY_V2_TIER_ORDER = Object.freeze(['mobile', 'medium', 'high', 'ultra']);

const SKY_V2_QUALITY_ALIASES = Object.freeze({
    low: 'mobile',
    minimal: 'mobile',
    med: 'medium',
    mid: 'medium',
    standard: 'high',
    default: 'high',
    max: 'ultra',
    extreme: 'ultra',
});

function clonePreset(preset) {
    if (!preset) return null;

    return {
        ...preset,
        post: {
            ...preset.post,
        },
    };
}

export function normalizeSkyV2QualityTier(value, fallback = 'high') {
    const fallbackTier = SKY_V2_QUALITY_PRESETS[fallback] ? fallback : 'high';
    if (!value) return fallbackTier;

    const normalized = String(value).trim().toLowerCase();
    if (SKY_V2_QUALITY_PRESETS[normalized]) {
        return normalized;
    }

    if (SKY_V2_QUALITY_ALIASES[normalized]) {
        return SKY_V2_QUALITY_ALIASES[normalized];
    }

    return fallbackTier;
}

export function getSkyV2QualityPreset(tier = 'high') {
    const normalized = normalizeSkyV2QualityTier(tier, 'high');
    return clonePreset(SKY_V2_QUALITY_PRESETS[normalized]);
}

export function listSkyV2QualityPresets() {
    return SKY_V2_TIER_ORDER.map((tier) => clonePreset(SKY_V2_QUALITY_PRESETS[tier]));
}

export function resolveSkyV2TierFromEffectQuality(effectQuality = 'High') {
    const normalized = String(effectQuality || 'High').trim().toLowerCase();
    if (normalized === 'minimal' || normalized === 'low') return 'mobile';
    if (normalized === 'medium') return 'medium';
    if (normalized === 'ultra' || normalized === 'extreme') return 'ultra';
    return 'high';
}
