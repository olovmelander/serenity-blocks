import { describe, expect, it } from 'vitest';
import {
    buildHubThemeThumbnailLookup,
    resolveHubThemeThumbnailUrl,
} from '../../src/ui/serenity-hub/theme-thumbnail-manifest.js';

describe('theme thumbnail manifest', () => {
    it('maps registry icons to bundled thumbnail urls', () => {
        const registry = [
            { id: 'forest', icon: './forest/forest-theme-icon.png' },
            { id: 'wolfhour', icon: './wolfhour/wolfhour-theme-icon.png' },
        ];
        const iconModules = {
            '../../themes/forest/forest-theme-icon.png': '/assets/forest.hash.png',
            '../../themes/wolfhour/wolfhour-theme-icon.png': '/assets/wolfhour.hash.png',
        };

        const lookup = buildHubThemeThumbnailLookup(registry, iconModules);

        expect(lookup.get('forest')).toBe('/assets/forest.hash.png');
        expect(resolveHubThemeThumbnailUrl('wolfhour', lookup)).toBe('/assets/wolfhour.hash.png');
    });

    it('falls back to forest when a theme thumbnail is missing', () => {
        const registry = [
            { id: 'forest', icon: './forest/forest-theme-icon.png' },
        ];
        const iconModules = {
            '../../themes/forest/forest-theme-icon.png': '/assets/forest.hash.png',
        };

        const lookup = buildHubThemeThumbnailLookup(registry, iconModules);

        expect(resolveHubThemeThumbnailUrl('unknown-theme', lookup)).toBe('/assets/forest.hash.png');
    });
});
