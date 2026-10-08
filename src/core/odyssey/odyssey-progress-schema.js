/** Save v3 records every theme actually completed, independently of authored remaps. */
export const ODYSSEY_SAVE_VERSION = 3;

// Frozen from the composed v2 campaign. Never derive a legacy award from live metadata.
const V2_LEVEL_THEME_IDS = Object.freeze([
    null,
    'cinder-drift', 'crystal-cave', 'geode', 'pyrestorm', 'bioluminescence',
    'ocean', 'luminous-tides', 'koi-pond', 'waves', 'misty-lake', 'stillwater',
    'forest', 'moonlit-forest', 'golden-forest', 'moonlit-greenhouse', 'tornado',
    'summer', 'fall', 'summer', 'sakura-twilight', 'verdant-hills', 'aurora',
    'wolfhour', 'himalayan-peak', 'mountain', 'winter', 'moonrise-summit',
    'sunset', 'starlight', 'aurora', 'nimbus-veil', 'rainy-window', 'aether-tides',
    'solar-eclipse', 'lunara', 'galaxy', 'cosmic-noir', 'supernova', 'blood-moon',
    'astral-weave', 'astral-weave', 'astral-weave', 'cosmic-chimes',
    'stellar-velocity', 'cosmic-noir', 'stellar-velocity', 'cosmic-chimes',
    'black-hole', 'fluid-dreams', 'nebula-flow', 'chromadelic-highway',
    'voltage-storm', 'chromatic-impasto', 'electric-dreams-v3', 'singing-bowl',
    'shifting-sands', 'neon-dusk', 'synthwave-sunset', 'neon-district',
]);

const isThemeId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);

/** A stable union; the singular themeId remains the latest saved successful theme. */
export function getOdysseyCompletionThemeIds(completion) {
    return [...new Set([
        ...(Array.isArray(completion?.themeIds) ? completion.themeIds : []),
        completion?.themeId,
    ].filter(isThemeId))].sort();
}

/** Called only for v1/v2 documents, after the v1 level-ID migration. */
export function snapshotLegacyOdysseyThemes(data) {
    Object.entries(data.completedLevels || {}).forEach(([rawId, completion]) => {
        if (!completion || typeof completion !== 'object' || Array.isArray(completion)) return;
        const levelId = Number(rawId);
        if (!Number.isInteger(levelId) || !V2_LEVEL_THEME_IDS[levelId]) return;
        const themeId = isThemeId(completion.themeId) ? completion.themeId : V2_LEVEL_THEME_IDS[levelId];
        completion.themeId = themeId;
        completion.themeIds = getOdysseyCompletionThemeIds(completion);
    });
    return data;
}
