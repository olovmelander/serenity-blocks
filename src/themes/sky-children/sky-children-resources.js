/**
 * Sky Children Phase 1 lighting defaults.
 * These values are tuned for Valley of Triumph sunset lookdev.
 */

export const SKY_CHILDREN_PHASE1_LIGHTING_DEFAULTS = Object.freeze({
    light: Object.freeze({
        direction: [0.32, 0.88, 0.34],
        color: [1.38, 1.20, 0.88],
        intensity: 1.68,
        ambientColor: [0.58, 0.78, 1.0],
        ambientIntensity: 0.36,
    }),
    shadow: Object.freeze({
        tint: [0.38, 0.52, 0.78],
        boost: 0.28,
    }),
    specular: Object.freeze({
        rimPower: 2.4,
        rimStrength: 0.72,
        rimColor: [1.0, 0.96, 0.82],
        oceanPower: 24.0,
        oceanStrength: 0.32,
        oceanColor: [0.98, 0.88, 0.66],
    }),
    glitter: Object.freeze({
        threshold: 0.978,
        intensity: 1.35,
        color: [1.0, 0.98, 0.86],
        enabled: true,
    }),
    controls: Object.freeze({
        yNormalCompression: 0.3,
        diffuseMultiplier: 4.0,
    }),
});

export const SKY_CHILDREN_PHASE2_TERRAIN_DEFAULTS = Object.freeze({
    albedoWarm: Object.freeze([0.40, 0.78, 0.30]),
    albedoCool: Object.freeze([0.10, 0.32, 0.26]),
    shadowColor: Object.freeze([0.08, 0.16, 0.28]),
    triplanarScale: 0.06,
    normalStrength: 0.82,
    rippleScale: 5.8,
    rippleSharpness: 3.2,
    roughnessNear: 0.28,
    roughnessFar: 0.72,
    roughnessFalloffStart: 22.0,
    roughnessFalloffEnd: 120.0,
    shimmerSuppression: 0.78,
    heightScale: 1.85,
    horizonLift: 3.8,
});

export const SKY_CHILDREN_PHASE3_CLOUD_DEFAULTS = Object.freeze({
    litColor: Object.freeze([1.0, 1.0, 1.0]),
    shadowColor: Object.freeze([0.58, 0.72, 0.94]),
    ambientColor: Object.freeze([0.90, 0.95, 1.0]),
    noiseScale: 1.28,
    noiseSpeed: 0.011,
    densityScale: 3.1,
    scatterG: 0.72,
    scatterIntensity: 2.0,
    edgeSoftness: 0.16,
    opacity: 0.90,
    coverage: 0.30,
    softness: 0.12,
    silverStrength: 1.7,
    silhouetteStrength: 1.5,
});

export const SKY_CHILDREN_PHASE4_FOLIAGE_DEFAULTS = Object.freeze({
    colorBase: Object.freeze([0.14, 0.44, 0.20]),
    colorTip: Object.freeze([0.78, 0.98, 0.56]),
    colorVariation: 0.2,
    sssColor: Object.freeze([0.92, 0.98, 0.58]),
    sssIntensity: 2.4,
    sssDistortion: 0.28,
    sssPower: 4.8,
    skyNormalBias: 0.58,
    alpha: 0.90,
    windStrength: 3.0,
    windFrequency: 1.25,
    windDirection: Object.freeze([0.78, 0.62]),
    gustStrength: 0.78,
    gustFrequency: 0.42,
    microStrength: 0.32,
    microFrequency: 4.2,
    bladeHeight: 2.45,
    instanceCount: 18000,
});

export const SKY_CHILDREN_PHASE5_POST_DEFAULTS = Object.freeze({
    bloomThreshold: 0.75,
    bloomSoftKnee: 0.30,
    bloomBlend: 0.42,
    bloomRadius: 1.12,
    exposure: 0.15,
    contrast: 1.12,
    saturation: 1.25,
    agxMix: 0.62,
    shadowColor: Object.freeze([0.70, 0.60, 1.20]),
    shadowStrength: 0.35,
    highlightColor: Object.freeze([1.30, 1.10, 0.80]),
    highlightStrength: 0.30,
    midtoneColor: Object.freeze([1.02, 0.98, 0.95]),
    midtoneStrength: 0.10,
});

export const SKY_CHILDREN_PHASE7_QUALITY_PRESETS = Object.freeze({
    mobile: Object.freeze({
        tier: 'mobile',
        label: 'Mobile',
        grassInstances: 3000,
        cloudMeshes: 3,
        cloudFbmOctaves: 2,
        bloomMipLevels: 4,
        sandGrainTextureResolution: 256,
        rippleNormalResolution: 256,
        renderScale: 0.6,
        sceneBudgetMs: 5.6,
        postBudgetMs: 1.2,
        targetFps: 60,
    }),
    medium: Object.freeze({
        tier: 'medium',
        label: 'Medium',
        grassInstances: 8000,
        cloudMeshes: 6,
        cloudFbmOctaves: 3,
        bloomMipLevels: 5,
        sandGrainTextureResolution: 512,
        rippleNormalResolution: 512,
        renderScale: 0.85,
        sceneBudgetMs: 6.8,
        postBudgetMs: 1.35,
        targetFps: 60,
    }),
    high: Object.freeze({
        tier: 'high',
        label: 'High',
        grassInstances: 14000,
        cloudMeshes: 10,
        cloudFbmOctaves: 4,
        bloomMipLevels: 6,
        sandGrainTextureResolution: 1024,
        rippleNormalResolution: 1024,
        renderScale: 1.0,
        sceneBudgetMs: 7.9,
        postBudgetMs: 1.5,
        targetFps: 60,
    }),
    ultra: Object.freeze({
        tier: 'ultra',
        label: 'Ultra',
        grassInstances: 22000,
        cloudMeshes: 15,
        cloudFbmOctaves: 5,
        bloomMipLevels: 7,
        sandGrainTextureResolution: 1024,
        rippleNormalResolution: 1024,
        renderScale: 1.0,
        sceneBudgetMs: 8.5,
        postBudgetMs: 1.65,
        targetFps: 60,
    }),
});

const SKY_CHILDREN_PHASE7_TIER_ORDER = Object.freeze(['mobile', 'medium', 'high', 'ultra']);

const SKY_CHILDREN_PHASE7_QUALITY_ALIASES = Object.freeze({
    low: 'mobile',
    mid: 'medium',
    med: 'medium',
    standard: 'high',
    default: 'high',
    max: 'ultra',
});

function cloneArray3(value, fallback) {
    if (!Array.isArray(value) || value.length < 3) return [...fallback];
    return [
        Number.isFinite(value[0]) ? value[0] : fallback[0],
        Number.isFinite(value[1]) ? value[1] : fallback[1],
        Number.isFinite(value[2]) ? value[2] : fallback[2],
    ];
}

function cloneArray2(value, fallback) {
    if (!Array.isArray(value) || value.length < 2) return [...fallback];
    return [
        Number.isFinite(value[0]) ? value[0] : fallback[0],
        Number.isFinite(value[1]) ? value[1] : fallback[1],
    ];
}

function clampNumber(value, fallback, min, max) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function clonePhase7Preset(preset) {
    if (!preset || typeof preset !== 'object') {
        return null;
    }
    return {
        tier: preset.tier,
        label: preset.label,
        grassInstances: preset.grassInstances,
        cloudMeshes: preset.cloudMeshes,
        cloudFbmOctaves: preset.cloudFbmOctaves,
        bloomMipLevels: preset.bloomMipLevels,
        sandGrainTextureResolution: preset.sandGrainTextureResolution,
        rippleNormalResolution: preset.rippleNormalResolution,
        renderScale: preset.renderScale,
        sceneBudgetMs: preset.sceneBudgetMs,
        postBudgetMs: preset.postBudgetMs,
        targetFps: preset.targetFps,
    };
}

export function normalizeSkyChildrenPhase7QualityTier(value, fallback = 'high') {
    const fallbackTier = String(fallback || 'high').trim().toLowerCase();
    if (SKY_CHILDREN_PHASE7_QUALITY_PRESETS[fallbackTier]) {
        fallback = fallbackTier;
    } else {
        fallback = 'high';
    }
    if (!value) return fallback;

    const normalized = String(value).trim().toLowerCase();
    if (SKY_CHILDREN_PHASE7_QUALITY_PRESETS[normalized]) {
        return normalized;
    }
    if (SKY_CHILDREN_PHASE7_QUALITY_ALIASES[normalized]) {
        return SKY_CHILDREN_PHASE7_QUALITY_ALIASES[normalized];
    }
    return fallback;
}

export function listSkyChildrenPhase7QualityPresets() {
    return SKY_CHILDREN_PHASE7_TIER_ORDER.map((tier) => (
        clonePhase7Preset(SKY_CHILDREN_PHASE7_QUALITY_PRESETS[tier])
    ));
}

export function getSkyChildrenPhase7QualityPreset(tier = 'high') {
    const normalized = normalizeSkyChildrenPhase7QualityTier(tier, 'high');
    return clonePhase7Preset(SKY_CHILDREN_PHASE7_QUALITY_PRESETS[normalized]);
}

/**
 * Create mutable lighting state from Phase 1 defaults.
 * Consumers can override only the fields they need for lookdev tuning.
 */
export function createSkyChildrenPhase1LightingState(overrides = {}) {
    const defaults = SKY_CHILDREN_PHASE1_LIGHTING_DEFAULTS;
    const light = overrides.light || {};
    const shadow = overrides.shadow || {};
    const specular = overrides.specular || {};
    const glitter = overrides.glitter || {};
    const controls = overrides.controls || {};

    return {
        light: {
            direction: cloneArray3(light.direction, defaults.light.direction),
            color: cloneArray3(light.color, defaults.light.color),
            intensity: clampNumber(light.intensity, defaults.light.intensity, 0, 8),
            ambientColor: cloneArray3(light.ambientColor, defaults.light.ambientColor),
            ambientIntensity: clampNumber(light.ambientIntensity, defaults.light.ambientIntensity, 0, 4),
        },
        shadow: {
            tint: cloneArray3(shadow.tint, defaults.shadow.tint),
            boost: clampNumber(shadow.boost, defaults.shadow.boost, 0, 1),
        },
        specular: {
            rimPower: clampNumber(specular.rimPower, defaults.specular.rimPower, 0.25, 16),
            rimStrength: clampNumber(specular.rimStrength, defaults.specular.rimStrength, 0, 4),
            rimColor: cloneArray3(specular.rimColor, defaults.specular.rimColor),
            oceanPower: clampNumber(specular.oceanPower, defaults.specular.oceanPower, 1, 128),
            oceanStrength: clampNumber(specular.oceanStrength, defaults.specular.oceanStrength, 0, 4),
            oceanColor: cloneArray3(specular.oceanColor, defaults.specular.oceanColor),
        },
        glitter: {
            threshold: clampNumber(glitter.threshold, defaults.glitter.threshold, 0.8, 0.9999),
            intensity: clampNumber(glitter.intensity, defaults.glitter.intensity, 0, 8),
            color: cloneArray3(glitter.color, defaults.glitter.color),
            enabled: typeof glitter.enabled === 'boolean' ? glitter.enabled : defaults.glitter.enabled,
        },
        controls: {
            yNormalCompression: clampNumber(
                controls.yNormalCompression,
                defaults.controls.yNormalCompression,
                0,
                1,
            ),
            diffuseMultiplier: clampNumber(
                controls.diffuseMultiplier,
                defaults.controls.diffuseMultiplier,
                0.25,
                8,
            ),
        },
    };
}

export function createSkyChildrenPhase2TerrainState(overrides = {}) {
    const defaults = SKY_CHILDREN_PHASE2_TERRAIN_DEFAULTS;

    return {
        albedoWarm: cloneArray3(overrides.albedoWarm, defaults.albedoWarm),
        albedoCool: cloneArray3(overrides.albedoCool, defaults.albedoCool),
        shadowColor: cloneArray3(overrides.shadowColor, defaults.shadowColor),
        triplanarScale: clampNumber(overrides.triplanarScale, defaults.triplanarScale, 0.005, 0.4),
        normalStrength: clampNumber(overrides.normalStrength, defaults.normalStrength, 0, 1),
        rippleScale: clampNumber(overrides.rippleScale, defaults.rippleScale, 0.25, 24),
        rippleSharpness: clampNumber(overrides.rippleSharpness, defaults.rippleSharpness, 0.5, 8),
        roughnessNear: clampNumber(overrides.roughnessNear, defaults.roughnessNear, 0, 1),
        roughnessFar: clampNumber(overrides.roughnessFar, defaults.roughnessFar, 0, 1),
        roughnessFalloffStart: clampNumber(overrides.roughnessFalloffStart, defaults.roughnessFalloffStart, 1, 4000),
        roughnessFalloffEnd: clampNumber(overrides.roughnessFalloffEnd, defaults.roughnessFalloffEnd, 2, 5000),
        shimmerSuppression: clampNumber(overrides.shimmerSuppression, defaults.shimmerSuppression, 0, 1),
        heightScale: clampNumber(overrides.heightScale, defaults.heightScale, 0.05, 4),
        horizonLift: clampNumber(overrides.horizonLift, defaults.horizonLift, 0, 20),
    };
}

export function createSkyChildrenPhase3CloudState(overrides = {}) {
    const defaults = SKY_CHILDREN_PHASE3_CLOUD_DEFAULTS;

    return {
        litColor: cloneArray3(overrides.litColor, defaults.litColor),
        shadowColor: cloneArray3(overrides.shadowColor, defaults.shadowColor),
        ambientColor: cloneArray3(overrides.ambientColor, defaults.ambientColor),
        noiseScale: clampNumber(overrides.noiseScale, defaults.noiseScale, 0.2, 8),
        noiseSpeed: clampNumber(overrides.noiseSpeed, defaults.noiseSpeed, 0, 0.2),
        densityScale: clampNumber(overrides.densityScale, defaults.densityScale, 0.2, 8),
        scatterG: clampNumber(overrides.scatterG, defaults.scatterG, -0.95, 0.95),
        scatterIntensity: clampNumber(overrides.scatterIntensity, defaults.scatterIntensity, 0, 8),
        edgeSoftness: clampNumber(overrides.edgeSoftness, defaults.edgeSoftness, 0.02, 1),
        opacity: clampNumber(overrides.opacity, defaults.opacity, 0, 1),
        coverage: clampNumber(overrides.coverage, defaults.coverage, 0.05, 0.95),
        softness: clampNumber(overrides.softness, defaults.softness, 0.02, 0.4),
        silverStrength: clampNumber(overrides.silverStrength, defaults.silverStrength, 0, 4),
        silhouetteStrength: clampNumber(overrides.silhouetteStrength, defaults.silhouetteStrength, 0, 4),
    };
}

export function createSkyChildrenPhase4FoliageState(overrides = {}) {
    const defaults = SKY_CHILDREN_PHASE4_FOLIAGE_DEFAULTS;

    return {
        colorBase: cloneArray3(overrides.colorBase, defaults.colorBase),
        colorTip: cloneArray3(overrides.colorTip, defaults.colorTip),
        colorVariation: clampNumber(overrides.colorVariation, defaults.colorVariation, 0, 0.5),
        sssColor: cloneArray3(overrides.sssColor, defaults.sssColor),
        sssIntensity: clampNumber(overrides.sssIntensity, defaults.sssIntensity, 0, 8),
        sssDistortion: clampNumber(overrides.sssDistortion, defaults.sssDistortion, 0, 2),
        sssPower: clampNumber(overrides.sssPower, defaults.sssPower, 0.5, 16),
        skyNormalBias: clampNumber(overrides.skyNormalBias, defaults.skyNormalBias, 0, 1),
        alpha: clampNumber(overrides.alpha, defaults.alpha, 0.1, 1),
        windStrength: clampNumber(overrides.windStrength, defaults.windStrength, 0, 6),
        windFrequency: clampNumber(overrides.windFrequency, defaults.windFrequency, 0.05, 8),
        windDirection: cloneArray2(overrides.windDirection, defaults.windDirection),
        gustStrength: clampNumber(overrides.gustStrength, defaults.gustStrength, 0, 2),
        gustFrequency: clampNumber(overrides.gustFrequency, defaults.gustFrequency, 0.05, 6),
        microStrength: clampNumber(overrides.microStrength, defaults.microStrength, 0, 1),
        microFrequency: clampNumber(overrides.microFrequency, defaults.microFrequency, 0.1, 12),
        bladeHeight: clampNumber(overrides.bladeHeight, defaults.bladeHeight, 0.2, 5),
        instanceCount: Math.floor(clampNumber(overrides.instanceCount, defaults.instanceCount, 256, 100000)),
    };
}

export function createSkyChildrenPhase5PostState(overrides = {}) {
    const defaults = SKY_CHILDREN_PHASE5_POST_DEFAULTS;

    return {
        bloomThreshold: clampNumber(overrides.bloomThreshold, defaults.bloomThreshold, 0.05, 4),
        bloomSoftKnee: clampNumber(overrides.bloomSoftKnee, defaults.bloomSoftKnee, 0.01, 1.2),
        bloomBlend: clampNumber(overrides.bloomBlend, defaults.bloomBlend, 0, 2),
        bloomRadius: clampNumber(overrides.bloomRadius, defaults.bloomRadius, 0.35, 4),
        exposure: clampNumber(overrides.exposure, defaults.exposure, -4, 4),
        contrast: clampNumber(overrides.contrast, defaults.contrast, 0.5, 2.2),
        saturation: clampNumber(overrides.saturation, defaults.saturation, 0, 2.5),
        agxMix: clampNumber(overrides.agxMix, defaults.agxMix, 0, 1),
        shadowColor: cloneArray3(overrides.shadowColor, defaults.shadowColor),
        shadowStrength: clampNumber(overrides.shadowStrength, defaults.shadowStrength, 0, 1.5),
        highlightColor: cloneArray3(overrides.highlightColor, defaults.highlightColor),
        highlightStrength: clampNumber(overrides.highlightStrength, defaults.highlightStrength, 0, 1.5),
        midtoneColor: cloneArray3(overrides.midtoneColor, defaults.midtoneColor),
        midtoneStrength: clampNumber(overrides.midtoneStrength, defaults.midtoneStrength, 0, 1.5),
    };
}
