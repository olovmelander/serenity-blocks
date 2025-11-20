/**
 * Color schemes for Nebula Flow theme
 * Each scheme defines primary, secondary, and ambient colors
 * Colors are in RGB format [r, g, b] where values are 0.0-1.0
 */

export const COLOR_SCHEMES = {
    cosmic: {
        name: 'Cosmic Nebula',
        description: 'Deep space purples and blues',
        primary: [0.7, 0.2, 1.0],      // Vibrant Purple
        secondary: [0.2, 0.4, 1.0],     // Electric Blue
        tertiary: [1.0, 0.3, 0.7],      // Hot Pink
        ambient: [0.05, 0.05, 0.15],    // Dark space
        palette: [
            [0.8, 0.2, 1.0],    // Bright Purple
            [0.2, 0.5, 1.0],    // Sky Blue
            [1.0, 0.2, 0.6],    // Magenta
            [0.5, 0.2, 1.0],    // Deep Purple
            [0.2, 0.7, 1.0],    // Cyan
            [0.9, 0.4, 0.8],    // Pink
            [0.3, 0.3, 1.0],    // Royal Blue
            [1.0, 0.5, 0.9],    // Light Magenta
        ],
    },

    ocean: {
        name: 'Ocean Depths',
        description: 'Cool aquatic colors',
        primary: [0.0, 0.8, 1.0],       // Bright Cyan
        secondary: [0.2, 1.0, 0.7],     // Aqua
        tertiary: [0.0, 0.5, 1.0],      // Ocean Blue
        ambient: [0.02, 0.08, 0.12],    // Dark water
        palette: [
            [0.0, 0.9, 1.0],    // Electric Cyan
            [0.2, 1.0, 0.8],    // Turquoise
            [0.0, 0.7, 1.0],    // Azure
            [0.1, 1.0, 0.6],    // Teal
            [0.0, 0.6, 0.9],    // Sky Blue
            [0.3, 0.9, 1.0],    // Light Cyan
            [0.1, 0.8, 0.7],    // Sea Green
            [0.0, 1.0, 0.9],    // Bright Aqua
        ],
    },

    aurora: {
        name: 'Aurora Borealis',
        description: 'Northern lights greens and purples',
        primary: [0.2, 1.0, 0.4],       // Bright Green
        secondary: [0.6, 0.2, 1.0],     // Vibrant Purple
        tertiary: [0.2, 0.8, 1.0],      // Bright Cyan
        ambient: [0.05, 0.1, 0.15],     // Night sky
        palette: [
            [0.3, 1.0, 0.5],    // Lime Green
            [0.7, 0.3, 1.0],    // Violet
            [0.2, 0.9, 1.0],    // Ice Blue
            [0.4, 1.0, 0.6],    // Spring Green
            [0.5, 0.2, 0.9],    // Purple
            [0.1, 1.0, 0.8],    // Teal
            [0.6, 1.0, 0.4],    // Yellow-Green
            [0.8, 0.4, 1.0],    // Lavender
        ],
    },

    fire: {
        name: 'Solar Flare',
        description: 'Warm oranges and reds',
        primary: [1.0, 0.5, 0.0],       // Bright Orange
        secondary: [1.0, 0.1, 0.0],     // Fiery Red
        tertiary: [1.0, 0.9, 0.0],      // Golden Yellow
        ambient: [0.1, 0.05, 0.02],     // Dark embers
        palette: [
            [1.0, 0.0, 0.0],    // Pure Red
            [1.0, 0.3, 0.0],    // Red-Orange
            [1.0, 0.6, 0.0],    // Orange
            [1.0, 0.8, 0.0],    // Amber
            [1.0, 1.0, 0.2],    // Yellow
            [1.0, 0.4, 0.1],    // Flame
            [1.0, 0.2, 0.0],    // Crimson
            [1.0, 0.7, 0.3],    // Peach
        ],
    },

    prismatic: {
        name: 'Prismatic',
        description: 'Rainbow spectrum',
        primary: [1.0, 0.2, 0.5],       // Hot Pink
        secondary: [0.2, 0.9, 1.0],     // Cyan
        tertiary: [0.5, 1.0, 0.2],      // Lime
        ambient: [0.08, 0.08, 0.08],    // Neutral dark
        palette: [
            [1.0, 0.0, 0.0],    // Pure Red
            [1.0, 0.5, 0.0],    // Orange
            [1.0, 1.0, 0.0],    // Yellow
            [0.5, 1.0, 0.0],    // Lime
            [0.0, 1.0, 0.5],    // Spring Green
            [0.0, 1.0, 1.0],    // Cyan
            [0.0, 0.5, 1.0],    // Sky Blue
            [0.5, 0.0, 1.0],    // Purple
            [1.0, 0.0, 0.5],    // Magenta
            [1.0, 0.3, 0.8],    // Pink
        ],
    },
};

/**
 * Get a random color from a scheme
 */
export function getRandomColor(scheme) {
    const palette = scheme.palette || [scheme.primary, scheme.secondary, scheme.tertiary];
    const base = palette[Math.floor(Math.random() * palette.length)];
    const ambientMix = 0.02 + Math.random() * 0.05; // Minimal ambient mixing for pure, vibrant colors
    const variation = 0.75 + Math.random() * 0.15; // Moderate brightness for rich colors

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
