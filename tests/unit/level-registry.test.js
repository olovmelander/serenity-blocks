import { describe, expect, it } from 'vitest';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { LEVEL_CONFIGS } from '../../src/core/odyssey/data/levels.js';
import {
    LevelRegistry,
} from '../../src/core/odyssey/LevelRegistry.js';

describe('LevelRegistry.reloadLevelData', () => {
    it('rebuilds registry state from the statically imported odyssey data', async () => {
        const registry = new LevelRegistry();
        registry.layoutData = {
            ...registry.layoutData,
            levelPositionsById: {
                ...registry.layoutData.levelPositionsById,
                1: 0.001,
            },
        };

        registry.levels.clear();
        registry.chapters.clear();
        registry.levelsByChapter.clear();
        registry.sortedLevels = [];

        await expect(registry.reloadLevelData()).resolves.toBe(true);

        expect(registry.getTotalLevels()).toBe(LEVEL_CONFIGS.length);
        expect(registry.getTotalChapters()).toBe(CHAPTER_CONFIGS.length);
        expect(registry.getLevel(1)?.pathPosition).toBeCloseTo(0.001, 3);
    });
});
