const VOID_EMBER_PRESETS = Object.freeze({
    low: Object.freeze({
        id: 'low',
        renderScale: 0.62,
        flowGridWidth: 72,
        flowGridHeight: 40,
        particleCount: 56,
        raySteps: 10,
        bloomStrength: 0.3,
        bloomThreshold: 1.15,
        anamorphicStrength: 0,
        temporalMix: 0,
        historyClamp: 0.08,
        noiseStrength: 0.0018,
        vignetteStrength: 0.34,
        exposure: 1.04,
        downshiftThresholdMs: 23.5,
        fallbackParticleCount: 22,
    }),
    medium: Object.freeze({
        id: 'medium',
        renderScale: 0.78,
        flowGridWidth: 96,
        flowGridHeight: 54,
        particleCount: 88,
        raySteps: 14,
        bloomStrength: 0.42,
        bloomThreshold: 1.05,
        anamorphicStrength: 0.04,
        temporalMix: 0,
        historyClamp: 0.075,
        noiseStrength: 0.0015,
        vignetteStrength: 0.4,
        exposure: 1.08,
        downshiftThresholdMs: 22.5,
        fallbackParticleCount: 28,
    }),
    high: Object.freeze({
        id: 'high',
        renderScale: 0.92,
        flowGridWidth: 128,
        flowGridHeight: 72,
        particleCount: 132,
        raySteps: 20,
        bloomStrength: 0.56,
        bloomThreshold: 0.98,
        anamorphicStrength: 0.08,
        temporalMix: 0.16,
        historyClamp: 0.065,
        noiseStrength: 0.0012,
        vignetteStrength: 0.46,
        exposure: 1.12,
        downshiftThresholdMs: 21.5,
        fallbackParticleCount: 36,
    }),
    ultra: Object.freeze({
        id: 'ultra',
        renderScale: 1,
        flowGridWidth: 160,
        flowGridHeight: 90,
        particleCount: 176,
        raySteps: 26,
        bloomStrength: 0.68,
        bloomThreshold: 0.9,
        anamorphicStrength: 0.14,
        temporalMix: 0.22,
        historyClamp: 0.055,
        noiseStrength: 0.001,
        vignetteStrength: 0.5,
        exposure: 1.16,
        downshiftThresholdMs: 20.8,
        fallbackParticleCount: 42,
    }),
});

const TIER_ORDER = Object.freeze(['low', 'medium', 'high', 'ultra']);

export function resolveVoidEmberTier(effectQuality = 'High') {
    const normalized = String(effectQuality || 'High').trim().toLowerCase();
    switch (normalized) {
    case 'minimal':
    case 'low':
        return 'low';
    case 'medium':
        return 'medium';
    case 'ultra':
    case 'extreme':
        return 'ultra';
    case 'custom':
    case 'high':
    default:
        return 'high';
    }
}

export function getVoidEmberQualityPreset(tier = 'high') {
    return VOID_EMBER_PRESETS[tier] || VOID_EMBER_PRESETS.high;
}

export function getVoidEmberPresetFromEffectQuality(effectQuality = 'High') {
    return getVoidEmberQualityPreset(resolveVoidEmberTier(effectQuality));
}

export function getLowerVoidEmberTier(tier = 'high') {
    const index = TIER_ORDER.indexOf(tier);
    if (index <= 0) {
        return null;
    }
    return TIER_ORDER[index - 1];
}

export function listVoidEmberTiers() {
    return [...TIER_ORDER];
}
