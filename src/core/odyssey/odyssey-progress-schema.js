/** Save v4 preserves orb identity across the 60-orb campaign edit. */
export const ODYSSEY_SAVE_VERSION = 4;

// Frozen authored challenge identities, indexed by v3 orb ID. The removed reef
// is archived; Vesper (43) and Warp (55) are new challenges, never old completions.
const V3_TO_V4_LEVEL_IDS = Object.freeze([
    null, 1, 2, 3, 4, 5, 6, 7, 8, 9, null,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 44, 45, 46, 47, 48, 49, 50,
    51, 52, 53, 54, 56, 57, 58, 59, 60,
]);
const V4_CHAPTER_END_IDS = Object.freeze([5, 10, 18, 26, 34, 48, 56, 60]);

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
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

export const isOdysseyCompletion = (value) => isRecord(value)
    && Number.isInteger(value.stars) && value.stars >= 1 && value.stars <= 3;

/** Interpret only archive identities authored by a supported campaign migration. */
export function getRetiredOdysseyCompletions(progress) {
    const completion = progress?.retiredCompletions?.['v3:10'];
    return isOdysseyCompletion(completion) ? [completion] : [];
}

export function migrateV3OdysseyLevelId(rawId) {
    const id = Number(rawId);
    return Number.isInteger(id) ? V3_TO_V4_LEVEL_IDS[id] ?? null : null;
}

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

/** Re-key campaign progress exactly once; theme history never determines orb identity. */
export function migrateV3OdysseyCampaign(data) {
    const previous = isRecord(data.completedLevels) ? data.completedLevels : {};
    const retired = isRecord(data.retiredCompletions) ? { ...data.retiredCompletions } : {};
    const completed = {};
    Object.entries(previous).forEach(([rawId, completion]) => {
        const id = migrateV3OdysseyLevelId(rawId);
        if (id) completed[id] = completion;
        else if (Number(rawId) === 10 && isRecord(completion)) retired['v3:10'] = completion;
    });
    const oldUnlocked = Array.isArray(data.unlockedLevels) ? data.unlockedLevels : [];
    const unlocked = new Set(oldUnlocked.map(migrateV3OdysseyLevelId).filter(Boolean));
    // Someone standing at the removed reef can continue to Stillwater.
    if (oldUnlocked.some((id) => Number(id) === 10)) unlocked.add(10);
    const visitedIds = [data.currentLevel, ...oldUnlocked,
        ...Object.keys(previous).filter((id) => isOdysseyCompletion(previous[id]))]
        .map(Number).filter((id) => Number.isInteger(id) && id >= 1 && id <= 59);
    const furthest = Math.max(0, ...visitedIds);
    [[43, 43], [55, 54]].forEach(([newId, precedingOldId]) => {
        if (furthest > precedingOldId || isOdysseyCompletion(previous[precedingOldId])) unlocked.add(newId);
    });
    if (unlocked.size === 0) unlocked.add(1);
    data.unlockedLevels = [...unlocked].sort((left, right) => left - right);
    data.completedLevels = completed;
    data.retiredCompletions = retired;
    data.currentLevel = Number(data.currentLevel) === 10 ? 10 : migrateV3OdysseyLevelId(data.currentLevel) || 1;
    data.currentChapter = V4_CHAPTER_END_IDS.findIndex((end) => data.currentLevel <= end) + 1;
    if (isRecord(data.statistics)) {
        data.statistics.totalStars = Object.values(completed)
            .reduce((sum, entry) => sum + (isOdysseyCompletion(entry) ? entry.stars : 0), 0);
        data.statistics.chaptersCompleted = V4_CHAPTER_END_IDS.filter((end, index) => {
            const start = index === 0 ? 1 : V4_CHAPTER_END_IDS[index - 1] + 1;
            return Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
                .every((id) => isOdysseyCompletion(completed[id]));
        }).length;
    }
    return data;
}
