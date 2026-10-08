import { ThemeCollectionService } from '../core/progression/theme-collection-service.js';
import { getLevelRegistry } from '../core/odyssey/LevelRegistry.js';
import { migrateOdysseyProgressData } from '../core/odyssey/OdysseyStateManager.js';
import { THEME_REGISTRY, resolveThemeId } from './theme-registry.js';

// Every orb owns one exclusive theme. These two collection bonuses have no orb assignment.
export const ODYSSEY_COLLECTION_REWARDS = Object.freeze([
    {
        type: 'milestone',
        count: 30,
        themeIds: ['vesper-chrysalis'],
        label: 'Complete 30 different Odyssey orbs.',
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
