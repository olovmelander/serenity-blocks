import { ThemeCollectionService } from '../core/progression/theme-collection-service.js';
import { getLevelRegistry } from '../core/odyssey/LevelRegistry.js';
import { migrateOdysseyProgressData } from '../core/odyssey/OdysseyStateManager.js';
import { THEME_REGISTRY, resolveThemeId } from './theme-registry.js';

export const ODYSSEY_COLLECTION_REWARDS = Object.freeze([
    {
        type: 'chapter', chapterId: 1, themeIds: ['void-ember'], label: 'Complete every orb in Odyssey chapter 1.',
    },
    {
        type: 'chapter',
        chapterId: 2,
        themeIds: ['bioluminescence-2'],
        label: 'Complete every orb in Odyssey chapter 2.',
    },
    {
        type: 'chapter', chapterId: 3, themeIds: ['halcyon-apex'], label: 'Complete every orb in Odyssey chapter 3.',
    },
    {
        type: 'chapter', chapterId: 4, themeIds: ['ice-temple'], label: 'Complete every orb in Odyssey chapter 4.',
    },
    {
        type: 'chapter', chapterId: 5, themeIds: ['sky-children'], label: 'Complete every orb in Odyssey chapter 5.',
    },
    {
        type: 'chapter', chapterId: 6, themeIds: ['stellar-drift'], label: 'Complete every orb in Odyssey chapter 6.',
    },
    {
        type: 'chapter', chapterId: 7, themeIds: ['chiral-gold'], label: 'Complete every orb in Odyssey chapter 7.',
    },
    {
        type: 'chapter', chapterId: 8, themeIds: ['parhelion'], label: 'Complete every orb in Odyssey chapter 8.',
    },
    {
        type: 'milestone', count: 30, themeIds: ['vesper-chrysalis'], label: 'Complete 30 different Odyssey orbs.',
    },
    { type: 'campaign', themeIds: ['serenity-warp'], label: 'Complete all 59 Odyssey orbs.' },
]);

let collection;

export function getThemeCollection() {
    let storage = null;
    try { storage = globalThis.localStorage; } catch { /* Private storage remains Forest-only. */ }
    if (!collection) {
        collection = new ThemeCollectionService({
            catalog: THEME_REGISTRY,
            levels: getLevelRegistry().getAllLevels(),
            rules: ODYSSEY_COLLECTION_REWARDS,
            resolveThemeId,
            migrateProgress: migrateOdysseyProgressData,
            storage,
            now: () => Date.now(),
        });
    }
    return collection;
}
