/**
 * Shared, deterministic lighting composition for Ocean.
 *
 * Keeping the surface aperture and its shaft bundle in one descriptor prevents
 * the water, atmosphere, and future post work from drifting toward different
 * implied light sources. Values are ordered by visual importance so quality
 * tiers can slice the same composition without changing its focal hierarchy.
 */

export const OCEAN_LIGHTING_RIG = Object.freeze({
    surfaceY: 72,
    // Pushed far enough forward to remain visible through the complete camera
    // drift envelope instead of slipping above frame at its highest pitch.
    sunCenter: Object.freeze({ x: -12, z: -100 }),
    apertureRadius: 46,
    surfaceColor: 0x73e8ff,
    coreColor: 0xfff2c9,
});

export const OCEAN_SHAFT_LAYOUT = Object.freeze([
    Object.freeze({
        topX: -7,
        topZ: -100,
        bottomX: -1,
        bottomZ: -54,
        topY: 74,
        bottomY: -27,
        topWidth: 7,
        bottomWidth: 22,
        seed: 46.32,
    }),
    Object.freeze({
        topX: 7,
        topZ: -104,
        bottomX: 22,
        bottomZ: -57,
        topY: 75,
        bottomY: -25,
        topWidth: 7.5,
        bottomWidth: 23,
        seed: 63.63,
    }),
    Object.freeze({
        topX: -20,
        topZ: -94,
        bottomX: -28,
        bottomZ: -48,
        topY: 74,
        bottomY: -25,
        topWidth: 8.5,
        bottomWidth: 24,
        seed: 29.01,
    }),
    Object.freeze({
        topX: -33,
        topZ: -96,
        bottomX: -50,
        bottomZ: -44,
        topY: 73,
        bottomY: -24,
        topWidth: 6.5,
        bottomWidth: 19,
        seed: 11.7,
    }),
    Object.freeze({
        topX: -42,
        topZ: -107,
        bottomX: -70,
        bottomZ: -72,
        topY: 73,
        bottomY: -29,
        topWidth: 5.5,
        bottomWidth: 17,
        seed: 80.94,
    }),
    Object.freeze({
        topX: 20,
        topZ: -95,
        bottomX: 48,
        bottomZ: -42,
        topY: 72,
        bottomY: -21,
        topWidth: 6.2,
        bottomWidth: 18,
        seed: 98.25,
    }),
    Object.freeze({
        topX: -53,
        topZ: -116,
        bottomX: -88,
        bottomZ: -102,
        topY: 76,
        bottomY: -31,
        topWidth: 5.8,
        bottomWidth: 19,
        seed: 115.56,
    }),
    Object.freeze({
        topX: 31,
        topZ: -112,
        bottomX: 72,
        bottomZ: -92,
        topY: 76,
        bottomY: -30,
        topWidth: 5.6,
        bottomWidth: 18,
        seed: 132.87,
    }),
]);
