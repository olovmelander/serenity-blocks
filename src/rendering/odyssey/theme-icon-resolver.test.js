import { describe, expect, it } from 'vitest';
import {
    buildThemeIconLookup,
    resolveThemeIconAssetUrl,
    resolveThemeIconUrl,
} from './theme-icon-resolver.js';

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
            { id: 'example', icon: './example-v2/example-theme-icon.png' },
            { id: 'example-v2', icon: './example-v2/example-theme-icon.png' },
        ];
        const iconModules = {
            '/src/themes/example-v2/example-theme-icon.png': '/assets/example.hash.png',
        };

        const lookup = buildThemeIconLookup(registry, iconModules);

        expect(resolveThemeIconUrl('example', lookup)).toBe('/assets/example.hash.png');
        expect(resolveThemeIconUrl('example-v2', lookup)).toBe('/assets/example.hash.png');
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

    it('supports lazy import.meta.glob loaders without eager theme imports', async () => {
        const registry = [
            { id: 'forest', icon: './forest/forest-theme-icon.png' },
            { id: 'aether-tides', icon: './aether-tides/aether-tides-theme-icon.png' },
        ];
        const iconModules = {
            '../../themes/forest/forest-theme-icon.png': () => Promise.resolve({ default: '/assets/forest.hash.png' }),
            '../../themes/aether-tides/aether-tides-theme-icon.png': () => Promise.resolve({ default: '/assets/aether.hash.png' }),
        };

        const lookup = buildThemeIconLookup(registry, iconModules);

        expect(resolveThemeIconUrl('aether-tides', lookup)).toBe(null);
        await expect(resolveThemeIconAssetUrl('aether-tides', lookup)).resolves.toBe('/assets/aether.hash.png');
    });
});
