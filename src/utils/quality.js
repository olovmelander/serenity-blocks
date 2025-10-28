const QUALITY_CONFIG = {
    High: {
        id: 'High',
        renderFrameSkip: 0,
        shakeMultiplier: 1,
        particles: true,
    },
    Medium: {
        id: 'Medium',
        renderFrameSkip: 1,
        shakeMultiplier: 0.75,
        particles: true,
    },
    Low: {
        id: 'Low',
        renderFrameSkip: 2,
        shakeMultiplier: 0.5,
        particles: false,
    },
};

export function normalizeQuality(level) {
    if (!level) return 'High';
    const normalized = String(level).trim().toLowerCase();
    if (normalized === 'low') return 'Low';
    if (normalized === 'medium') return 'Medium';
    return 'High';
}

export function getQualityConfig(level) {
    const normalized = normalizeQuality(level);
    return QUALITY_CONFIG[normalized] || QUALITY_CONFIG.High;
}

export function shouldRenderParticles(level) {
    return getQualityConfig(level).particles;
}

export function getShakeMultiplier(level) {
    return getQualityConfig(level).shakeMultiplier;
}

export function getRenderFrameSkip(level) {
    return getQualityConfig(level).renderFrameSkip;
}
