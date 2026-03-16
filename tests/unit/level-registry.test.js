import {
    describe,
    expect,
    it,
} from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';

describe('LevelRegistry presentation data', () => {
    it('resolves level presentation defaults from authored level data', () => {
        const registry = new LevelRegistry();

        const level = registry.resolveLevelPresentation(1);

        expect(level).toBeTruthy();
        expect(level.id).toBe(1);
        expect(level.name).toBe('Ashen Dawn');
        expect(level.pathLabel).toBe('Ashen Dawn');
        expect(level.iconThemeId).toBe(level.theme.primary);
        expect(level.transitionPaletteThemeId).toBe(level.theme.primary);
        expect(level.description).toBe(level.metadata.description);
    });

    it('derives presentation layout from authored path positions', () => {
        const registry = new LevelRegistry();

        const layout = registry.getPresentationLayout();

        expect(layout.totalLevels).toBe(55);
        expect(layout.controlPoints.length).toBeGreaterThan(10);
        expect(layout.levelPositionsById[1]).toBe(0);
        expect(layout.levelPositionsById[55]).toBe(1);
        expect(layout.levelPositions).toHaveLength(55);
        expect(layout.chapterPositions).toEqual([
            0,
            0.093,
            0.204,
            0.352,
            0.5,
            0.648,
            0.815,
            0.944,
            1,
        ]);
        expect(layout.chapterRanges[0]).toMatchObject({
            chapterId: 1,
            startLevelId: 1,
            endLevelId: 5,
            startPosition: 0,
            endPosition: 0.093,
        });
        expect(layout.chapterRanges[7]).toMatchObject({
            chapterId: 8,
            startLevelId: 52,
            endLevelId: 55,
            startPosition: 0.944,
            endPosition: 1,
        });
        expect(layout.chapterRanges[3]).toMatchObject({
            chapterId: 4,
            startLevelId: 20,
            endLevelId: 27,
            startPosition: 0.352,
            endPosition: 0.5,
        });
        expect(layout.chapterRanges[4]).toMatchObject({
            chapterId: 5,
            startLevelId: 28,
            endLevelId: 35,
            startPosition: 0.5,
            endPosition: 0.648,
        });

        for (let index = 1; index < layout.levelPositions.length; index += 1) {
            expect(layout.levelPositions[index]).toBeGreaterThan(layout.levelPositions[index - 1]);
        }
    });

    it('validates presentation palettes, path ordering, and chapter ranges', () => {
        const registry = new LevelRegistry();

        const report = registry.validateAll();

        expect(report.valid).toBe(true);
        expect(report.presentationErrors).toEqual([]);
        expect(report.chapterErrors).toEqual([]);
    });
});
