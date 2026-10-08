/** Versioned, monotonic cosmetic ownership. Catalog and platform are injected. */
export const THEME_COLLECTION_VERSION = 1;
export const THEME_COLLECTION_STORAGE_KEY = 'serenityBlocks_themeCollection';
export const THEME_COLLECTION_RECOVERY_STORAGE_KEY = 'serenityBlocks_themeCollection_recoveryBackup';
export const ODYSSEY_PROGRESS_STORAGE_KEY = 'serenityBlocks_odysseyProgress';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SOURCES = new Set(['starter', 'odyssey', 'chapter', 'milestone', 'campaign']);
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function normalizeThemeCollection(data, resolveThemeId = (id) => id) {
    if (!isRecord(data) || Number(data.version) !== THEME_COLLECTION_VERSION) return null;
    const grants = {};
    if (isRecord(data.grants)) {
        Object.entries(data.grants).forEach(([rawId, value]) => {
            const id = resolveThemeId(rawId);
            if (!ID_PATTERN.test(id) || !isRecord(value) || !SOURCES.has(value.source)) return;
            const grant = { source: value.source };
            if (Number.isSafeInteger(value.levelId) && value.levelId > 0) grant.levelId = value.levelId;
            if (Number.isFinite(Date.parse(value.earnedAt))) grant.earnedAt = new Date(value.earnedAt).toISOString();
            if (!grants[id] || JSON.stringify(grant) < JSON.stringify(grants[id])) grants[id] = grant;
        });
    }
    grants.forest = { source: 'starter' };
    const seenThemeIds = [...new Set((Array.isArray(data.seenThemeIds) ? data.seenThemeIds : [])
        .filter((id) => typeof id === 'string').map(resolveThemeId)
        .filter((id) => Object.hasOwn(grants, id)))].sort();
    if (!seenThemeIds.includes('forest')) seenThemeIds.push('forest');
    seenThemeIds.sort();
    return {
        version: THEME_COLLECTION_VERSION,
        grants: Object.fromEntries(Object.entries(grants).sort(([left], [right]) => left.localeCompare(right))),
        seenThemeIds,
        updatedAt: Number.isFinite(data.updatedAt) && data.updatedAt >= 0 ? data.updatedAt : 0,
    };
}

export function createThemeCollectionData() {
    return normalizeThemeCollection({ version: THEME_COLLECTION_VERSION });
}

/** A deterministic, commutative union: a newer clock can never revoke ownership. */
export function mergeThemeCollections(left, right, resolveThemeId = (id) => id) {
    const first = normalizeThemeCollection(left, resolveThemeId);
    const second = normalizeThemeCollection(right, resolveThemeId);
    if (!first || !second) return null;
    const grants = { ...first.grants };
    Object.entries(second.grants).forEach(([id, grant]) => {
        if (!grants[id] || JSON.stringify(grant) < JSON.stringify(grants[id])) grants[id] = grant;
    });
    return normalizeThemeCollection({
        version: THEME_COLLECTION_VERSION,
        grants,
        seenThemeIds: [...first.seenThemeIds, ...second.seenThemeIds],
        updatedAt: Math.max(first.updatedAt, second.updatedAt),
    }, resolveThemeId);
}

export function sameThemeCollection(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

/** Reject malformed completion values; never infer completion from unlocked levels. */
export function getValidCompletedLevels(progress, levels) {
    const entries = progress?.completedLevels instanceof Map
        ? [...progress.completedLevels] : Object.entries(progress?.completedLevels || {});
    const validIds = new Set(levels.map((level) => level.id));
    return new Map(entries.filter(([rawId, completion]) => {
        const id = Number(rawId);
        return Number.isSafeInteger(id) && validIds.has(id) && isRecord(completion)
            && Number.isInteger(completion.stars) && completion.stars >= 1 && completion.stars <= 3;
    }).map(([id, completion]) => [Number(id), completion]));
}
