export const TORNADO_PARAM_DEFAULTS = {
    emissiveColor: '#ff8a3b',
    timeScale: 1.0,
    parabolaStrength: 1.0,
    parabolaOffset: 0.35,
    parabolaAmplitude: 0.45,
    bloomStrength: 1.0,
    bloomRadius: 0.2,
};

export const TORNADO_PARAM_RANGES = {
    emissiveColor: { type: 'color' },
    timeScale: { min: 0.1, max: 3.0, step: 0.01 },
    parabolaStrength: { min: 0.0, max: 4.0, step: 0.01 },
    parabolaOffset: { min: -1.0, max: 1.0, step: 0.01 },
    parabolaAmplitude: { min: 0.0, max: 3.0, step: 0.01 },
    bloomStrength: { min: 0.0, max: 3.0, step: 0.01 },
    bloomRadius: { min: 0.0, max: 1.0, step: 0.01 },
};
