/**
 * Color schemes for Nebula Flow theme
 * Each scheme defines primary, secondary, and ambient colors
 * Colors are in RGB format [r, g, b] where values are 0.0-1.0
 */

export const COLOR_SCHEMES = {
    cosmic: {
        name: 'Cosmic Nebula',
        description: 'Deep space purples and blues',
        primary: [0.6, 0.3, 0.9],      // Purple
        secondary: [0.2, 0.5, 1.0],     // Blue
        tertiary: [0.9, 0.4, 0.6],      // Pink
        ambient: [0.05, 0.05, 0.15],    // Dark space
        palette: [
            [0.64, 0.38, 0.82],
            [0.36, 0.48, 0.92],
            [0.74, 0.42, 0.68],
            [0.48, 0.32, 0.88],
            [0.28, 0.55, 0.86],
            [0.58, 0.36, 0.76],
        ],
    },

    ocean: {
        name: 'Ocean Depths',
        description: 'Cool aquatic colors',
        primary: [0.1, 0.6, 0.8],       // Cyan
        secondary: [0.2, 0.8, 0.6],     // Teal
        tertiary: [0.0, 0.4, 0.7],      // Deep blue
        ambient: [0.02, 0.08, 0.12],    // Dark water
        palette: [
            [0.18, 0.64, 0.74],
            [0.16, 0.56, 0.82],
            [0.22, 0.72, 0.58],
            [0.08, 0.46, 0.68],
            [0.14, 0.62, 0.66],
            [0.10, 0.52, 0.78],
        ],
    },

    aurora: {
        name: 'Aurora Borealis',
        description: 'Northern lights greens and purples',
        primary: [0.3, 0.9, 0.5],       // Green
        secondary: [0.5, 0.3, 0.9],     // Purple
        tertiary: [0.2, 0.7, 0.8],      // Cyan
        ambient: [0.05, 0.1, 0.15],     // Night sky
        palette: [
            [0.28, 0.78, 0.58],
            [0.22, 0.68, 0.82],
            [0.46, 0.42, 0.86],
            [0.36, 0.76, 0.66],
            [0.24, 0.62, 0.74],
            [0.52, 0.48, 0.88],
        ],
    },

    fire: {
        name: 'Solar Flare',
        description: 'Warm oranges and reds',
        primary: [1.0, 0.5, 0.1],       // Orange
        secondary: [1.0, 0.2, 0.2],     // Red
        tertiary: [1.0, 0.8, 0.2],      // Yellow
        ambient: [0.1, 0.05, 0.02],     // Dark embers
        palette: [
            [0.92, 0.44, 0.18],
            [0.88, 0.32, 0.24],
            [0.96, 0.58, 0.22],
            [0.84, 0.28, 0.18],
            [0.90, 0.48, 0.26],
            [0.86, 0.36, 0.20],
        ],
    },

    prismatic: {
        name: 'Prismatic',
        description: 'Rainbow spectrum',
        primary: [1.0, 0.3, 0.5],       // Pink
        secondary: [0.3, 0.8, 1.0],     // Sky blue
        tertiary: [0.5, 1.0, 0.3],      // Lime
        ambient: [0.08, 0.08, 0.08],    // Neutral dark
        palette: [
            [0.88, 0.34, 0.54],
            [0.34, 0.74, 0.96],
            [0.52, 0.92, 0.42],
            [0.78, 0.42, 0.74],
            [0.42, 0.86, 0.82],
            [0.92, 0.56, 0.38],
        ],
    },
};

/**
 * Get a random color from a scheme
 */
export function getRandomColor(scheme) {
    const palette = scheme.palette || [scheme.primary, scheme.secondary, scheme.tertiary];
    const base = palette[Math.floor(Math.random() * palette.length)];
    const ambientMix = 0.25 + Math.random() * 0.25; // Soften with ambient tones
    const variation = 0.85 + Math.random() * 0.25; // Gentle brightness variation

    const clamp = (value) => Math.max(0, Math.min(1, value));

    return [
        clamp(base[0] * variation * (1 - ambientMix) + scheme.ambient[0] * ambientMix),
        clamp(base[1] * variation * (1 - ambientMix) + scheme.ambient[1] * ambientMix),
        clamp(base[2] * variation * (1 - ambientMix) + scheme.ambient[2] * ambientMix),
    ];
}

/**
 * Interpolate between two colors
 */
export function lerpColor(color1, color2, t) {
    return [
        color1[0] + (color2[0] - color1[0]) * t,
        color1[1] + (color2[1] - color1[1]) * t,
        color1[2] + (color2[2] - color1[2]) * t,
    ];
}

/**
 * Get scheme by name, defaults to cosmic
 */
export function getColorScheme(name) {
    return COLOR_SCHEMES[name] || COLOR_SCHEMES.cosmic;
}
