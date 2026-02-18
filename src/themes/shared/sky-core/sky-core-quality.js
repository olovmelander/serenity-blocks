export const SKY_V2_QUALITY_PRESETS = Object.freeze({
    mobile: Object.freeze({
        tier: 'mobile',
        label: 'Mobile',
        renderScale: 0.62,
        terrainSegments: 112,
        mountainMeshes: 4,
        cloudClusters: 8,
        cloudPuffsPerCluster: 4,
        grassNearCount: 1800,
        grassMidCount: 2000,
        flowerAnchorCount: 450,
        flowerAnchorMin: 180,
        flowerCarpetCoverageTarget: 0.06,
        flowerHeadsCount: 1800,
        flowerStemsCount: 2400,
        flowerGroundLiftHead: 0.66,
        flowerGroundLiftStem: 0.34,
        flowerWhiteShareMax: 0.1,
        flowerAnchorCellSize: 10,
        flowerCarpetStrength: 0.82,
        flowerFarTintStrength: 0.2,
        flowerNearCount: 1800,
        flowerRibbonDensity: 0.82,
        farCoverageStrength: 0.34,
        grassInstances: 3800,
        flowerInstances: 1800,
        fogDensity: 0.00135,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.22,
            bloomRadius: 0.46,
            bloomThreshold: 0.88,
            exposure: 1.02,
            contrast: 1.02,
            saturation: 1.06,
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
        cloudClusters: 12,
        cloudPuffsPerCluster: 5,
        grassNearCount: 4200,
        grassMidCount: 4200,
        flowerAnchorCount: 1100,
        flowerAnchorMin: 420,
        flowerCarpetCoverageTarget: 0.1,
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
        grassInstances: 8400,
        flowerInstances: 4400,
        fogDensity: 0.00115,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.26,
            bloomRadius: 0.52,
            bloomThreshold: 0.86,
            exposure: 1.03,
            contrast: 1.04,
            saturation: 1.1,
            vignetteDarkness: 0.2,
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
        cloudClusters: 16,
        cloudPuffsPerCluster: 6,
        grassNearCount: 7000,
        grassMidCount: 6200,
        flowerAnchorCount: 2100,
        flowerAnchorMin: 900,
        flowerCarpetCoverageTarget: 0.14,
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
        grassInstances: 13200,
        flowerInstances: 8400,
        fogDensity: 0.00095,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.32,
            bloomRadius: 0.58,
            bloomThreshold: 0.84,
            exposure: 1.04,
            contrast: 1.06,
            saturation: 1.14,
            vignetteDarkness: 0.22,
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
        grassNearCount: 10200,
        grassMidCount: 8800,
        flowerAnchorCount: 3000,
        flowerAnchorMin: 1300,
        flowerCarpetCoverageTarget: 0.18,
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
        grassInstances: 19000,
        flowerInstances: 12000,
        fogDensity: 0.00082,
        post: Object.freeze({
            enabled: true,
            bloomStrength: 0.36,
            bloomRadius: 0.62,
            bloomThreshold: 0.82,
            exposure: 1.05,
            contrast: 1.08,
            saturation: 1.16,
            vignetteDarkness: 0.24,
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
