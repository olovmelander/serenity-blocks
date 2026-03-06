/**
 * Warp quality profiles used by the Orb-Portal transition.
 * These are tuned for desktop-first visuals with scalable fallbacks.
 */
export const WARP_QUALITY_PROFILES = {
    Ultra: {
        name: 'Ultra',
        starCount: 5200,
        spiralCount: 2200,
        pixelRatioCap: 2,
        stretchMultiplier: 1.2,
        shakeMultiplier: 1.1,
        flashGamma: 2.8,
        intakeStrength: 1.25,
        chromaticSplitScale: 1.1,
        enableDebrisStreaks: true,
    },
    High: {
        name: 'High',
        starCount: 4000,
        spiralCount: 1500,
        pixelRatioCap: 1.75,
        stretchMultiplier: 1,
        shakeMultiplier: 1,
        flashGamma: 2.5,
        intakeStrength: 1,
        chromaticSplitScale: 1,
        enableDebrisStreaks: true,
    },
    Medium: {
        name: 'Medium',
        starCount: 2400,
        spiralCount: 900,
        pixelRatioCap: 1.25,
        stretchMultiplier: 0.85,
        shakeMultiplier: 0.75,
        flashGamma: 2.2,
        intakeStrength: 0.58,
        chromaticSplitScale: 0.45,
        enableDebrisStreaks: false,
    },
};

export function resolveWarpQualityProfile(requested = 'High') {
    const aliases = {
        Extreme: 'Ultra',
        Low: 'Medium',
        Minimal: 'Medium',
    };

    const normalized = aliases[requested] || requested;

    if (normalized && WARP_QUALITY_PROFILES[normalized]) {
        return WARP_QUALITY_PROFILES[normalized];
    }
    return WARP_QUALITY_PROFILES.High;
}

export default WARP_QUALITY_PROFILES;
