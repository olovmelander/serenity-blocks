import { describe, expect, it } from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getOdysseyThemePresentationPalette } from '../../src/core/odyssey/theme-presentation.js';
import { ThemeCollectionService } from '../../src/core/progression/theme-collection-service.js';
import { ODYSSEY_COLLECTION_REWARDS } from '../../src/themes/theme-collection.js';
import { THEME_REGISTRY, resolveThemeId } from '../../src/themes/theme-registry.js';

const registry = new LevelRegistry();
const levels = registry.getAllLevels();
const catalog = new Map(THEME_REGISTRY.map((theme) => [theme.id, theme]));
const orbThemes = levels.map((level) => level.theme.primary);
const bonusThemes = ODYSSEY_COLLECTION_REWARDS.flatMap((rule) => rule.themeIds);

describe('Odyssey exclusive orb themes', () => {
    it('gives each of the 59 orbs a registered canonical theme outside the Forest starter', () => {
        expect(levels).toHaveLength(59);
        expect(new Set(orbThemes).size).toBe(59);
        expect(orbThemes).not.toContain('forest');
        for (const themeId of orbThemes) {
            expect(catalog.has(themeId), themeId).toBe(true);
            expect(resolveThemeId(themeId)).toBe(themeId);
        }
    });

    it('partitions the complete collection into the starter, exclusive orbs and two separate bonuses', () => {
        expect(bonusThemes).toEqual(['vesper-chrysalis', 'serenity-warp']);
        const routes = ['forest', ...orbThemes, ...bonusThemes];
        expect(routes).toHaveLength(THEME_REGISTRY.length);
        expect(new Set(routes).size).toBe(routes.length);
        expect(new Set(routes)).toEqual(new Set(catalog.keys()));
        expect(ODYSSEY_COLLECTION_REWARDS).toMatchObject([
            { type: 'milestone', count: 30 },
            { type: 'campaign' },
        ]);
    });

    it('keeps each chapter theme catalog in sync with its composed orb order', () => {
        for (const chapter of registry.getAllChapters()) {
            const themes = registry.getLevelsInChapter(chapter.id).map((level) => level.theme.primary);
            expect(chapter.themes.primary, chapter.name).toEqual(themes);
            expect(chapter.themes.supporting, chapter.name).toEqual([]);
            expect(registry.getChapterThemes(chapter.id)).toEqual(themes);
        }
    });

    it('shows the same theme identity in the orb icon, transition palette and collection route', () => {
        const collection = new ThemeCollectionService({
            catalog: THEME_REGISTRY,
            levels,
            rules: ODYSSEY_COLLECTION_REWARDS,
            resolveThemeId,
            storage: { getItem: () => null, setItem: () => {} },
            now: () => 0,
        });
        expect(collection.getOwnedThemeIds()).toEqual(['forest']);
        for (const level of levels) {
            const themeId = level.theme.primary;
            const presentation = registry.resolveLevelPresentation(level.id);
            expect(presentation.iconThemeId).toBe(themeId);
            expect(presentation.transitionPaletteThemeId).toBe(themeId);
            expect(presentation.pathLabel).toBe(level.name);
            expect(catalog.get(themeId).icon).toBeTruthy();
            expect(getOdysseyThemePresentationPalette(themeId)).not.toBeNull();
            expect(collection.getThemeStatus(themeId)).toMatchObject({
                owned: false,
                requirement: { type: 'orb', levelId: level.id, chapterId: level.chapter },
            });
        }
    });

    it('retains the authored chapter anchors and the deliberate alien-to-abstract-to-city bridge', () => {
        expect(registry.getLevel(1).theme.primary).toBe('cinder-drift');
        expect(registry.getLevel(43).theme.primary).toBe('shifting-sands');
        expect(registry.getLevel(51).theme.primary).toBe('chiral-gold');
        expect(registry.getLevel(56).theme.primary).toBe('chromadelic-highway');
        expect(registry.getLevel(57).theme.primary).toBe('neon-dusk');
        expect(registry.getLevel(57).chapter).toBe(8);
        expect(registry.validateAll()).toMatchObject({
            valid: true, presentationErrors: [], chapterErrors: [], warnings: [],
        });
    });
});
