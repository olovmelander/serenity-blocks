import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { buildThemeIconLookup, resolveThemeIconUrl } from '../../rendering/odyssey/theme-icon-resolver.js';

const themeIconModules = import.meta.glob('../../themes/**/*-theme-icon.{png,svg}', {
    eager: true,
    import: 'default',
});

const themeThumbnailLookup = buildHubThemeThumbnailLookup(THEME_REGISTRY, themeIconModules);

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

export { themeThumbnailLookup };
