/**
 * Neon District — where each painted shopfront's windows and door are (CPU only, three-free).
 *
 * The paintings are a whole shopfront each: sign, walls, windows and door. In the street the
 * window-and-door part is set back into the wall (the shop shader traces the recess, its jambs,
 * soffit and threshold, and wet glass in front of the painted windows), while the sign and the
 * walls around it stay flush. These rects say which part is which: (u0, v0, u1, v1) in fractions
 * of the source image, v measured DOWN from its top. Read off a 10 % grid laid over each image.
 */
export const PAINTED_OPENINGS = Object.freeze({
    'storefront_03.jpg': [0.12, 0.4, 0.905, 0.97],
    'storefront_04.jpg': [0.11, 0.38, 0.975, 0.93],
    'storefront_05.jpg': [0.12, 0.39, 0.91, 0.95],
    'storefront_06.jpg': [0.12, 0.39, 0.91, 0.95],
    'storefront_07.jpg': [0.03, 0.49, 0.94, 0.93],
    'storefront_08.jpg': [0.14, 0.35, 0.955, 0.99],
    'storefront_09.jpg': [0.28, 0.44, 0.735, 0.995],
    'storefront_10.jpg': [0.4, 0.43, 0.745, 0.99],
    'storefront_11.jpg': [0.06, 0.5, 0.97, 0.99],
    'storefront_12.jpg': [0.22, 0.45, 0.86, 0.97],
    'storefront_13.jpg': [0.23, 0.43, 0.83, 0.99],
    'storefront_14.jpg': [0.1, 0.52, 0.9, 0.99],
    'storefront_15.jpg': [0.06, 0.52, 0.94, 0.99],
    'storefront_16.jpg': [0.08, 0.39, 0.86, 0.99],
    'storefront_17.jpg': [0.06, 0.47, 0.93, 0.99],
    'storefront_18.jpg': [0.06, 0.4, 0.94, 0.99],
});
