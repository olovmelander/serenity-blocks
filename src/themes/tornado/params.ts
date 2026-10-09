/**
 * Tornado — the live controls of the Themes tab (settings.tornadoThemeParams).
 *
 * The keys are the settings' own and predate the 2026-10 rebuild, so a saved value still loads;
 * what each one moves in the rebuilt scene (TornadoWorld.setLiveParams, TornadoPost.setLiveParams):
 *
 *   emissiveColor      the storm light: tints the sun, the bright gap and everything they light
 *   timeScale          wind speed: the funnel's turn, the updraught, the gusts, the cloud's winding
 *   ribbonWidth        the funnel's girth
 *   parabolaStrength   how far the funnel sways, like a rope hung from the cloud
 *   parabolaOffset     which way the foot leans (0.35 = upright)
 *   parabolaAmplitude  how wide the funnel flares into the wall cloud
 *   bloomStrength      bloom, as a multiple of the quality tier's own
 *   bloomRadius        how far the bloom spreads
 *
 * The defaults leave the scene as authored (tornado-world.js keeps the same reference values and
 * a unit test holds the two together).
 */
export const TORNADO_PARAM_DEFAULTS = {
    emissiveColor: '#ff8a3b',
    timeScale: 1.0,
    ribbonWidth: 1.0,
    parabolaStrength: 1.0,
    parabolaOffset: 0.35,
    parabolaAmplitude: 0.45,
    bloomStrength: 1.0,
    bloomRadius: 0.2,
};

export const TORNADO_PARAM_RANGES = {
    emissiveColor: { type: 'color' },
    timeScale: { min: 0.1, max: 3.0, step: 0.01 },
    ribbonWidth: { min: 0.5, max: 1.5, step: 0.01 },
    parabolaStrength: { min: 0.0, max: 4.0, step: 0.01 },
    parabolaOffset: { min: -1.0, max: 1.0, step: 0.01 },
    parabolaAmplitude: { min: 0.0, max: 3.0, step: 0.01 },
    bloomStrength: { min: 0.0, max: 3.0, step: 0.01 },
    bloomRadius: { min: 0.0, max: 1.0, step: 0.01 },
};
