/**
 * Intro visual presets and quality budgets.
 * Centralized so renderer/animation logic can be phase-driven without magic numbers.
 */

export const INTRO_PHASES = {
    BOOT: 'boot',
    REVEAL: 'reveal',
    IDLE: 'idle',
    HERO_INHALE: 'hero_inhale',
    DISMISS: 'dismiss',
    MENU_BG: 'menu_bg',
};

const createQualityBudget = (key, values) => ({ key, ...values });

export const INTRO_VISUAL_PROFILES = {
    cinematic_clean: {
        id: 'cinematic_clean',
        palette: {
            deepSpace: 0x05000f,
            indigo: 0x3c2fb0,
            cyan: 0x63dbff,
            violet: 0x8667ff,
            titleGlow: [0.44, 0.79, 1.0],
            titleGlowSecondary: [0.52, 0.44, 1.0],
        },
        post: {
            bloomThreshold: 0.58,
            bloomRadius: 0.8,
            vignette: 0.028,
            grain: 0.0025,
            baseExposure: 1.13,
        },
        particle: {
            layers: {
                far: {
                    ratio: 0.68,
                    sizeMin: 0.07,
                    sizeMax: 0.19,
                    speedMul: 0.72,
                },
                mid: {
                    ratio: 0.24,
                    sizeMin: 0.21,
                    sizeMax: 0.39,
                    speedMul: 1.0,
                },
                near: {
                    ratio: 0.08,
                    sizeMin: 0.4,
                    sizeMax: 0.72,
                    speedMul: 1.36,
                },
            },
            eventOpacity: 1.0,
        },
        phaseCurves: {
            [INTRO_PHASES.BOOT]: {
                durationMs: 420,
                bloomMul: 0.65,
                attractionMul: 0.88,
                spawnMul: 0.8,
                titleGlowMul: 0.2,
                particleMul: 0.85,
                cameraDriftMul: 0.72,
            },
            [INTRO_PHASES.REVEAL]: {
                durationMs: 900,
                bloomMul: 1.0,
                attractionMul: 1.0,
                spawnMul: 1.0,
                titleGlowMul: 1.0,
                particleMul: 1.0,
                cameraDriftMul: 1.0,
            },
            [INTRO_PHASES.IDLE]: {
                durationMs: 520,
                bloomMul: 0.92,
                attractionMul: 1.0,
                spawnMul: 0.92,
                titleGlowMul: 0.9,
                particleMul: 1.0,
                cameraDriftMul: 0.9,
            },
            [INTRO_PHASES.HERO_INHALE]: {
                durationMs: 1150,
                bloomMul: 1.15,
                attractionMul: 1.45,
                spawnMul: 0.75,
                titleGlowMul: 1.25,
                particleMul: 1.08,
                cameraDriftMul: 0.68,
            },
            [INTRO_PHASES.DISMISS]: {
                durationMs: 800,
                bloomMul: 1.25,
                attractionMul: 1.22,
                spawnMul: 0.4,
                titleGlowMul: 1.15,
                particleMul: 1.05,
                cameraDriftMul: 0.55,
            },
            [INTRO_PHASES.MENU_BG]: {
                durationMs: 700,
                bloomMul: 0.48,
                attractionMul: 0.72,
                spawnMul: 0.5,
                titleGlowMul: 0.5,
                particleMul: 0.62,
                cameraDriftMul: 0.42,
            },
        },
        heroInhale: {
            intervalMin: 6.0,
            intervalMax: 8.0,
            holdDuration: 1.1,
            releaseDuration: 0.95,
        },
        qualityBudgets: {
            HIGH: createQualityBudget('HIGH', {
                bloom: true,
                bloomStrength: 0.34,
                godRays: 0.0,
                dof: 0.015,
                fringe: 0.0,
                nebulaClouds: 0,
                maxTetrominos: 50,
                pixelRatio: 1.45,
                spawnInterval: 1.45,
                computeFrameSkip: 1,
                attraction: 0.86,
            }),
            MEDIUM: createQualityBudget('MEDIUM', {
                bloom: true,
                bloomStrength: 0.28,
                godRays: 0.0,
                dof: 0.01,
                fringe: 0.0,
                nebulaClouds: 0,
                maxTetrominos: 36,
                pixelRatio: 1.12,
                spawnInterval: 1.85,
                computeFrameSkip: 2,
                attraction: 0.64,
            }),
            LOW: createQualityBudget('LOW', {
                bloom: false,
                bloomStrength: 0.0,
                godRays: 0.0,
                dof: 0.0,
                fringe: 0.0,
                nebulaClouds: 0,
                maxTetrominos: 20,
                pixelRatio: 1.0,
                spawnInterval: 2.45,
                computeFrameSkip: 3,
                attraction: 0.44,
            }),
        },
    },
};

export function getIntroVisualProfile(profileId = 'cinematic_clean') {
    return INTRO_VISUAL_PROFILES[profileId] || INTRO_VISUAL_PROFILES.cinematic_clean;
}

export function getQualityBudget(profile, level = 'HIGH') {
    const selected = profile?.qualityBudgets?.[level];
    if (selected) return { ...selected };
    return { ...profile.qualityBudgets.HIGH };
}
