const THEME_PRIMARY_COLORS = Object.freeze({
    'aether-tides': '#7cc8ff',
    'astral-weave': '#31d7ff',
    aurora: '#59f3cf',
    bioluminescence: '#59f7c4',
    'black-hole': '#6b54ff',
    'blood-moon': '#ff5e73',
    'chromadelic-highway': '#ff8f1f',
    'chromatic-impasto': '#ff6b2f',
    'cinder-drift': '#ff7a3d',
    'cosmic-chimes': '#7ce8ff',
    'cosmic-noir': '#5c7dff',
    'crystal-cave': '#8cf4ff',
    'electric-dreams': '#00f5ff',
    fall: '#f5a34a',
    'fluid-dreams': '#5fe3ff',
    forest: '#68c76d',
    galaxy: '#7e81ff',
    geode: '#a77bff',
    'himalayan-peak': '#cce4ff',
    'ice-temple': '#b3f2ff',
    'koi-pond': '#ffae73',
    'luminous-tides': '#6fe8ff',
    lunara: '#c7a4ff',
    'misty-lake': '#8fd8ff',
    'moonlit-forest': '#84a4ff',
    'moonlit-greenhouse': '#6bc894',
    'moonrise-summit': '#d8ecff',
    mountain: '#9fb4cc',
    'nebula-flow': '#57d7ff',
    'neon-district': '#00f1ff',
    'neon-dusk': '#ff6da8',
    'nimbus-veil': '#8fb9ff',
    ocean: '#2da8ff',
    pyrestorm: '#ff5b2e',
    'rainy-window': '#7fa9ff',
    'sakura-twilight': '#ff8fc6',
    'shifting-sands': '#ffd66e',
    'singing-bowl': '#d7bfff',
    'solar-eclipse': '#ffcf58',
    starlight: '#8fd2ff',
    'stellar-velocity': '#8a6eff',
    stillwater: '#71c8ff',
    summer: '#ffd45f',
    sunset: '#ff9a57',
    supernova: '#ff8a4f',
    'swedish-forest': '#7ad372',
    'synthwave-sunset': '#ff66a8',
    tornado: '#9aa7bf',
    'verdant-hills': '#8fd768',
    'voltage-storm': '#8d72ff',
    waves: '#5ec5ff',
    winter: '#dff5ff',
    wolfhour: '#91a7d8',
});

function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    const normalized = hex.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return null;
    }

    return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16),
    };
}

function rgbToHex({ r, g, b }) {
    return `#${[r, g, b].map((value) => clampByte(value).toString(16).padStart(2, '0')).join('')}`;
}

function mixColors(leftHex, rightHex, amount) {
    const left = hexToRgb(leftHex);
    const right = hexToRgb(rightHex);
    if (!left || !right) {
        return leftHex || rightHex || '#ffffff';
    }

    const t = Math.max(0, Math.min(1, amount));
    return rgbToHex({
        r: (left.r * (1 - t)) + (right.r * t),
        g: (left.g * (1 - t)) + (right.g * t),
        b: (left.b * (1 - t)) + (right.b * t),
    });
}

export function hasOdysseyThemePresentationPalette(themeId) {
    return typeof THEME_PRIMARY_COLORS[themeId] === 'string';
}

export function getOdysseyThemePresentationPalette(themeId) {
    const primary = THEME_PRIMARY_COLORS[themeId];
    if (!primary) {
        return null;
    }

    return {
        primary,
        accent: mixColors(primary, '#ffffff', 0.24),
        highlight: mixColors(primary, '#ffffff', 0.58),
        shadow: mixColors(primary, '#05070d', 0.72),
    };
}

export { THEME_PRIMARY_COLORS as ODYSSEY_THEME_PRESENTATION_COLORS };
