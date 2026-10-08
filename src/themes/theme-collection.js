import { ThemeCollectionService } from '../core/progression/theme-collection-service.js';
import { getLevelRegistry } from '../core/odyssey/LevelRegistry.js';
import { migrateOdysseyProgressData } from '../core/odyssey/OdysseyStateManager.js';
import { THEME_REGISTRY, resolveThemeId } from './theme-registry.js';

// Forest is the starter; every other theme is earned from its own Odyssey orb.
export const ODYSSEY_COLLECTION_REWARDS = Object.freeze([]);

let collection;

/** URL-only preview access; never read or persist a localStorage override. */
export function isDevelopmentCollectionUnlocked(search = globalThis.location?.search || '') {
    return new URLSearchParams(search).get('unlockAll') === '1';
}

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
            developmentUnlockAll: isDevelopmentCollectionUnlocked(),
        });
    }
    return collection;
}
