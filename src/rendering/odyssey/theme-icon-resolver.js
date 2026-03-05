/**
 * @fileoverview Theme icon URL resolver for Odyssey level node rendering.
 */

function toThemesRelativePath(pathValue) {
    if (typeof pathValue !== 'string' || pathValue.length === 0) {
        return null;
    }

    const normalized = pathValue.replace(/\\/g, '/');
    const themesToken = 'themes/';
    const themesIndex = normalized.lastIndexOf(themesToken);

    if (themesIndex >= 0) {
        return normalized.slice(themesIndex + themesToken.length);
    }

    return normalized.replace(/^(\.\/|\.\.\/)+/, '');
}

function toFileName(pathValue) {
    if (typeof pathValue !== 'string' || pathValue.length === 0) {
        return null;
    }

    const normalized = pathValue.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Build lookup of theme id to icon URL emitted by Vite.
 *
 * @param {Array<{id: string, icon?: string}>} registry
 * @param {Record<string, string>} iconModules - Result of import.meta.glob(..., { eager: true, import: 'default' })
 * @returns {Map<string, string>}
 */
export function buildThemeIconLookup(registry, iconModules) {
    const lookup = new Map();
    if (!Array.isArray(registry)) {
        return lookup;
    }

    const byRelativePath = new Map();
    const byFileName = new Map();

    Object.entries(iconModules || {}).forEach(([modulePath, iconUrl]) => {
        if (typeof iconUrl !== 'string' || iconUrl.length === 0) {
            return;
        }

        const relativePath = toThemesRelativePath(modulePath);
        if (!relativePath) {
            return;
        }

        byRelativePath.set(relativePath, iconUrl);

        const fileName = toFileName(relativePath);
        if (fileName && !byFileName.has(fileName)) {
            byFileName.set(fileName, iconUrl);
        }
    });

    registry.forEach((theme) => {
        const themeId = theme?.id;
        if (!themeId) {
            return;
        }

        const relativeIconPath = toThemesRelativePath(theme?.icon);
        if (!relativeIconPath) {
            return;
        }

        const direct = byRelativePath.get(relativeIconPath);
        if (direct) {
            lookup.set(themeId, direct);
            return;
        }

        const fileName = toFileName(relativeIconPath);
        const byName = fileName ? byFileName.get(fileName) : null;
        if (byName) {
            lookup.set(themeId, byName);
        }
    });

    return lookup;
}

function getLookupValue(themeId, lookup) {
    if (!themeId || !lookup) {
        return null;
    }

    if (lookup instanceof Map) {
        return lookup.get(themeId) || null;
    }

    if (typeof lookup === 'object') {
        return lookup[themeId] || null;
    }

    return null;
}

/**
 * Resolve the icon URL for a theme id with fallback support.
 *
 * @param {string} themeId
 * @param {Map<string, string> | Object} lookup
 * @param {string} fallbackThemeId
 * @returns {string|null}
 */
export function resolveThemeIconUrl(themeId, lookup, fallbackThemeId = 'forest') {
    const direct = getLookupValue(themeId, lookup);
    if (direct) {
        return direct;
    }

    if (!fallbackThemeId) {
        return null;
    }

    return getLookupValue(fallbackThemeId, lookup);
}
