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
    it('gives each of the 60 orbs a registered canonical theme outside the Forest starter', () => {
        expect(levels).toHaveLength(60);
        expect(new Set(orbThemes).size).toBe(60);
        expect(orbThemes).not.toContain('forest');
        for (const themeId of orbThemes) {
            expect(catalog.has(themeId), themeId).toBe(true);
            expect(resolveThemeId(themeId)).toBe(themeId);
        }
    });

    it('gives every non-starter theme exactly one orb and no bonus route', () => {
        expect(bonusThemes).toEqual([]);
        expect(THEME_REGISTRY).toHaveLength(61);
        expect(catalog.has('bioluminescence-2')).toBe(false);
        const routes = ['forest', ...orbThemes, ...bonusThemes];
        expect(routes).toHaveLength(THEME_REGISTRY.length);
        expect(new Set(routes).size).toBe(routes.length);
        expect(new Set(routes)).toEqual(new Set(catalog.keys()));
        expect(ODYSSEY_COLLECTION_REWARDS).toEqual([]);
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
        expect(registry.getLevel(42).theme.primary).toBe('shifting-sands');
        expect(registry.getLevel(43).theme.primary).toBe('vesper-chrysalis');
        expect(registry.getLevel(51).theme.primary).toBe('chiral-gold');
        expect(registry.getLevel(55).theme.primary).toBe('serenity-warp');
        expect(registry.getLevel(56).theme.primary).toBe('singing-bowl');
        expect(registry.getLevel(57).theme.primary).toBe('chromadelic-highway');
        expect(registry.getLevel(58).theme.primary).toBe('neon-dusk');
        expect(registry.getLevel(58).chapter).toBe(8);
        expect(registry.validateAll()).toMatchObject({
            valid: true, presentationErrors: [], chapterErrors: [], warnings: [],
        });
    });

    it('places the two new orbs between existing neighbors without changing chapter boundaries', () => {
        for (const [id, left, right] of [[43, 42, 44], [55, 54, 56]]) {
            expect(registry.getLevel(id).pathPosition).toBeCloseTo(
                (registry.getLevel(left).pathPosition + registry.getLevel(right).pathPosition) / 2,
                8,
            );
        }
        expect(registry.getAllChapters().map((chapter) => chapter.levelRange)).toEqual([
            [1, 5], [6, 10], [11, 18], [19, 26], [27, 34], [35, 48], [49, 56], [57, 60],
        ]);
        expect(levels.map((level) => level.id)).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
        expect(registry.getNextLevel(59).id).toBe(60);
        expect(registry.getNextLevel(60)).toBeNull();
        expect(registry.isFinalLevel(59)).toBe(false);
        expect(registry.isFinalLevel(60)).toBe(true);
    });

    it('uses a score release and a bounded cascade rehearsal before the established capstones', () => {
        const vesper = registry.getLevel(43);
        const warp = registry.getLevel(55);
        expect(vesper.role).toBe('release');
        expect(vesper.victory.primary).toEqual({ type: 'score', target: 43000 });
        expect(vesper.victory.failure.type).toBe('top-out');
        expect(warp.role).toBe('teach');
        expect(warp.victory.primary).toEqual({ type: 'cascade', target: 10 });
        expect(warp.victory.failure.type).toBe('top-out');
        expect(warp.mechanics.board).toEqual({ columns: 10, rows: 36, startingRows: 10 });
        expect(warp.mechanics.speed.fixedDropInterval).toBe(600);
        expect(warp.stars.three).toEqual({ cascades: 10, maxCascadeDepth: 4 });
        expect(warp.metadata.difficultyModel.profile).toBe('tall-board-rehearsal');
        expect(warp.mechanics.board.rows).toBeLessThan(registry.getLevel(56).mechanics.board.rows);
        expect(registry.getLevel(56).isChapterEnd).toBe(true);
    });
});
