const QUALITY_CONFIG = {
    Extreme: {
        id: 'Extreme',
        renderFrameSkip: 0,
        renderScale: 1.0,
        shakeMultiplier: 1.2,
        particles: true,
        particleBudget: {
            maxTotal: 900,
            lineClear: 90,
            combo: 180,
            trail: 150,
            background: 120,
        },
        effectsEnabled: {
            bloom: true,
            trails: true,
            ripples: true,
            comboPopups: true,
            backgroundEffects: true,
        },
    },
    Ultra: {
        id: 'Ultra',
        renderFrameSkip: 0,
        renderScale: 1.0,
        shakeMultiplier: 1.0,
        particles: true,
        particleBudget: {
            maxTotal: 600,
            lineClear: 60,
            combo: 120,
            trail: 100,
            background: 80,
        },
        effectsEnabled: {
            bloom: true,
            trails: true,
            ripples: true,
            comboPopups: true,
            backgroundEffects: true,
        },
    },
    High: {
        id: 'High',
        renderFrameSkip: 0,
        renderScale: 1.0,
        shakeMultiplier: 1.0,
        particles: true,
        particleBudget: {
            maxTotal: 300,
            lineClear: 30,
            combo: 60,
            trail: 50,
            background: 40,
        },
        effectsEnabled: {
            bloom: true,
            trails: true,
            ripples: true,
            comboPopups: true,
            backgroundEffects: true,
        },
    },
    Medium: {
        id: 'Medium',
        renderFrameSkip: 0,  // No frame skip - backgrounds perform well
        renderScale: 0.75,
        shakeMultiplier: 0.75,
        particles: true,
        particleBudget: {
            maxTotal: 150,
            lineClear: 15,
            combo: 30,
            trail: 20,
            background: 20,
        },
        effectsEnabled: {
            bloom: false,
            trails: true,
            ripples: true,
            comboPopups: true,
            backgroundEffects: true,
        },
    },
    Low: {
        id: 'Low',
        renderFrameSkip: 0,  // No frame skip - backgrounds perform well
        renderScale: 0.5,
        shakeMultiplier: 0.5,
        particles: false,
        particleBudget: {
            maxTotal: 50,
            lineClear: 5,
            combo: 10,
            trail: 0,
            background: 10,
        },
        effectsEnabled: {
            bloom: false,
            trails: false,
            ripples: false,
            comboPopups: true,
            backgroundEffects: false,
        },
    },
    Minimal: {
        id: 'Minimal',
        renderFrameSkip: 0,  // No frame skip - backgrounds perform well
        renderScale: 0.4,
        shakeMultiplier: 0.3,
        particles: false,
        particleBudget: {
            maxTotal: 20,
            lineClear: 2,
            combo: 5,
            trail: 0,
            background: 3,
        },
        effectsEnabled: {
            bloom: false,
            trails: false,
            ripples: false,
            comboPopups: true,
            backgroundEffects: false,
        },
    },
};

export function normalizeQuality(level) {
    if (!level) return 'High';
    const normalized = String(level).trim().toLowerCase();
    if (normalized === 'minimal') return 'Minimal';
    if (normalized === 'low') return 'Low';
    if (normalized === 'medium') return 'Medium';
    if (normalized === 'high') return 'High';
    if (normalized === 'ultra') return 'Ultra';
    if (normalized === 'extreme') return 'Extreme';
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

export function getParticleBudget(level) {
    return getQualityConfig(level).particleBudget;
}

export function getRenderScale(level) {
    return getQualityConfig(level).renderScale;
}

export function getEffectsEnabled(level) {
    return getQualityConfig(level).effectsEnabled;
}

export function isEffectEnabled(level, effectName) {
    const effects = getEffectsEnabled(level);
    return effects[effectName] !== false;
}
