import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    THEME_REGISTRY,
    getThemeMeta,
    resolveThemeId,
} from '../../src/themes/theme-registry.js';
import {
    getThemeForMusic,
    getThemeMusic,
    resolveMusicTrackKey,
} from '../../src/core/progression/theme-music-catalog.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';

const sunfallDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'src',
    'themes',
    'sunfall',
);

describe('sunfall-rename-migration', () => {
    it('registers sunfall in THEME_REGISTRY and resolves retired moonrise-summit to sunfall', () => {
        expect(resolveThemeId('moonrise-summit')).toBe('sunfall');
        expect(resolveThemeId('sunfall')).toBe('sunfall');

        const meta = getThemeMeta('sunfall');
        expect(meta).toBeDefined();
        expect(meta.id).toBe('sunfall');
        expect(meta.displayName).toBe('Sunfall');
        expect(meta.group).toBe('biomes');
        expect(meta.icon).toBe('./sunfall/sunfall-theme-icon.png');
        expect(THEME_REGISTRY.some((t) => t.id === 'moonrise-summit')).toBe(false);
    });

    it('maps sunfall to Sunfall track in theme-music-catalog and resolves retired MoonriseSummit', () => {
        expect(resolveMusicTrackKey('MoonriseSummit')).toBe('Sunfall');
        expect(getThemeForMusic('Sunfall')).toBe('sunfall');
        expect(getThemeForMusic('MoonriseSummit')).toBe('sunfall');

        const song = getThemeMusic('sunfall');
        expect(song).toBeDefined();
        expect(song.trackKey).toBe('Sunfall');
        expect(getThemeMusic('moonrise-summit')?.trackKey).toBe('Sunfall');
    });

    it('updates Odyssey Garden Under Stone and Cloud Walker levels and Chapter 4 to sunfall', () => {
        const gardenLevel = LEVEL_CONFIGS.find((l) => l.name === 'Garden Under Stone');
        const cloudWalker = LEVEL_CONFIGS.find((l) => l.name === 'Cloud Walker');
        expect(gardenLevel).toBeDefined();
        expect(gardenLevel.theme.primary).toBe('sunfall');
        expect(cloudWalker).toBeDefined();
        expect(cloudWalker.theme.overlays).toContain('sunfall');

        const chapter4 = CHAPTER_CONFIGS.find((c) => c.id === 4);
        expect(chapter4.themes.primary).toContain('sunfall');
        expect(chapter4.themes.primary).not.toContain('moonrise-summit');
    });

    it('never uses the forbidden word "cathedral" anywhere in src/themes/sunfall/', () => {
        const files = readdirSync(sunfallDir).filter((f) => f.endsWith('.js'));
        expect(files.length).toBeGreaterThanOrEqual(8);
        for (const file of files) {
            const content = readFileSync(path.join(sunfallDir, file), 'utf8');
            expect(content.toLowerCase()).not.toContain('cathedral');
        }
    });
});
