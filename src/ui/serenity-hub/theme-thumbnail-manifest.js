import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { buildThemeIconLookup, resolveThemeIconUrl } from '../../rendering/odyssey/theme-icon-resolver.js';

const themeIconModules = import.meta.glob('../../themes/**/*-theme-icon.{png,svg}', {
    eager: true,
    import: 'default',
});

const themeThumbnailLookup = buildHubThemeThumbnailLookup(THEME_REGISTRY, themeIconModules);

function getRuntimeBaseUrl() {
    if (typeof window === 'undefined') {
        return '/';
    }

    const baseUrl = import.meta.env?.BASE_URL || '/';
    return new URL(baseUrl, window.location.href).href;
}

export function buildHubThemeThumbnailLookup(themeRegistry, iconModules) {
    return buildThemeIconLookup(themeRegistry, iconModules);
}

export function resolveHubThemeThumbnailUrl(
    themeId,
    lookup = themeThumbnailLookup,
    fallbackThemeId = 'forest',
) {
    return resolveThemeIconUrl(themeId, lookup, fallbackThemeId);
}

export function resolveDesktopHubThemeThumbnailUrl(themeId) {
    if (!themeId) {
        return null;
    }

    const baseUrl = getRuntimeBaseUrl();
    return new URL(`assets/theme-thumbnails/${themeId}-theme-icon.png`, baseUrl).href;
}

export { themeThumbnailLookup };
