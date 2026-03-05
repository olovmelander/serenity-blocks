import { describe, expect, it } from 'vitest';
import { buildThemeIconLookup, resolveThemeIconUrl } from './theme-icon-resolver.js';

describe('theme-icon-resolver', () => {
    it('maps a valid theme icon path to bundled icon URL', () => {
        const registry = [
            { id: 'cinder-drift', icon: './cinder-drift/cinder-drift-theme-icon.png' },
        ];
        const iconModules = {
            '../../themes/cinder-drift/cinder-drift-theme-icon.png': '/assets/cinder-drift.hash.png',
        };

        const lookup = buildThemeIconLookup(registry, iconModules);

        expect(lookup.get('cinder-drift')).toBe('/assets/cinder-drift.hash.png');
        expect(resolveThemeIconUrl('cinder-drift', lookup)).toBe('/assets/cinder-drift.hash.png');
    });

    it('supports alias/path variations for registry and glob module keys', () => {
        const registry = [
            { id: 'sky-children', icon: './sky-children-v2/sky-children-theme-icon.png' },
            { id: 'sky-children-v2', icon: './sky-children-v2/sky-children-theme-icon.png' },
        ];
        const iconModules = {
            '/src/themes/sky-children-v2/sky-children-theme-icon.png': '/assets/sky-children.hash.png',
        };

        const lookup = buildThemeIconLookup(registry, iconModules);

        expect(resolveThemeIconUrl('sky-children', lookup)).toBe('/assets/sky-children.hash.png');
        expect(resolveThemeIconUrl('sky-children-v2', lookup)).toBe('/assets/sky-children.hash.png');
    });

    it('falls back to forest icon for unknown themes', () => {
        const registry = [
            { id: 'forest', icon: './forest/forest-theme-icon.png' },
            { id: 'geode', icon: './geode/geode-theme-icon.png' },
        ];
        const iconModules = {
            '../../themes/forest/forest-theme-icon.png': '/assets/forest.hash.png',
            '../../themes/geode/geode-theme-icon.png': '/assets/geode.hash.png',
        };

        const lookup = buildThemeIconLookup(registry, iconModules);

        expect(resolveThemeIconUrl('unknown-theme', lookup)).toBe('/assets/forest.hash.png');
    });

    it('returns null when requested and fallback icons are missing', () => {
        const registry = [
            { id: 'forest', icon: './forest/forest-theme-icon.png' },
        ];
        const iconModules = {};

        const lookup = buildThemeIconLookup(registry, iconModules);

        expect(resolveThemeIconUrl('missing-theme', lookup, 'forest')).toBe(null);
    });
});
