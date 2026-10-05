/**
 * Neon District — content tiers.
 *
 * rooms            interior-mapped rooms behind the street's windows (else flat lit panes)
 * reflection       planar reflector resolution scale for the wet street (0 = mirror the glow map)
 * reflectionTaps   taps down the wet-asphalt smear (1, 3 or 5)
 * rainRings        rain rings in the puddles
 * rain             rain streak instances
 * halos            humid-air glow cards around signs and lamps
 * steam            steam vent puffs per vent (0 = none)
 * traffic          flying vehicles
 * sparks           event spark pool
 * drones           light drones in the four-line dragon (0 = no dragon)
 */
export const QUALITY = Object.freeze({
    Minimal: Object.freeze({
        rooms: false,
        reflection: 0,
        reflectionTaps: 1,
        rainRings: false,
        rain: 1400,
        halos: false,
        steam: 0,
        traffic: 24,
        sparks: 96,
        drones: 0,
    }),
    Low: Object.freeze({
        rooms: false,
        reflection: 0,
        reflectionTaps: 1,
        rainRings: true,
        rain: 2600,
        halos: false,
        steam: 0,
        traffic: 40,
        sparks: 160,
        drones: 900,
    }),
    Medium: Object.freeze({
        rooms: true,
        reflection: 0.36,
        reflectionTaps: 3,
        rainRings: true,
        rain: 5200,
        halos: true,
        steam: 5,
        traffic: 64,
        sparks: 320,
        drones: 2600,
    }),
    High: Object.freeze({
        rooms: true,
        reflection: 0.5,
        reflectionTaps: 3,
        rainRings: true,
        rain: 9000,
        halos: true,
        steam: 7,
        traffic: 96,
        sparks: 512,
        drones: 5200,
    }),
    Ultra: Object.freeze({
        rooms: true,
        reflection: 0.6,
        reflectionTaps: 5,
        rainRings: true,
        rain: 13000,
        halos: true,
        steam: 9,
        traffic: 128,
        sparks: 768,
        drones: 8400,
    }),
    Extreme: Object.freeze({
        rooms: true,
        reflection: 0.75,
        reflectionTaps: 5,
        rainRings: true,
        rain: 18000,
        halos: true,
        steam: 11,
        traffic: 160,
        sparks: 1024,
        drones: 12000,
    }),
});

export const QUALITY_NAMES = Object.freeze(Object.keys(QUALITY));

export function tierFor(quality) {
    return QUALITY[quality] || QUALITY.High;
}
