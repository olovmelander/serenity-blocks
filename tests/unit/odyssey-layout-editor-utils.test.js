import { describe, expect, it } from 'vitest';
import {
    ODYSSEY_LAYOUT_DATA,
    parseOdysseyLayoutData,
    serializeOdysseyLayoutData,
} from '../../src/core/odyssey/data/odyssey-layout.js';
import {
    appendTailControlPoint,
    densifyControlPointSegments,
    getKeyboardNudgeStep,
    insertControlPointAfterIndex,
    moveLevelAlongPath,
    nudgeControlPointAtIndex,
    retimeChapterBoundary,
    spreadAllChapterLevelsEvenly,
    spreadChapterLevelsEvenly,
    subdivideControlPointSegments,
    stretchPathControlPoints,
} from '../../src/rendering/odyssey/odyssey-layout-editor-utils.js';

describe('odyssey layout editor utils', () => {
    it('uses fine, default, and coarse keyboard nudge steps based on modifiers', () => {
        expect(getKeyboardNudgeStep()).toBeCloseTo(0.002, 6);
        expect(getKeyboardNudgeStep({ altKey: true })).toBeCloseTo(0.0005, 6);
        expect(getKeyboardNudgeStep({ shiftKey: true })).toBeCloseTo(0.01, 6);
        expect(getKeyboardNudgeStep(
            { altKey: true, shiftKey: true },
        )).toBeCloseTo(0.01, 6);
    });

    it('nudges a selected path control point without mutating the original array', () => {
        const controlPoints = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 20, z: -10 },
        ];

        const nudged = nudgeControlPointAtIndex(controlPoints, 1, {
            x: 0.5,
            y: -2,
            z: 1.25,
        });

        expect(controlPoints[1]).toEqual({ x: 10, y: 20, z: -10 });
        expect(nudged[1]).toEqual({
            x: 10.5,
            y: 18,
            z: -8.75,
        });
    });

    it('inserts a new control point midway after the selected path point', () => {
        const controlPoints = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 20, z: -10 },
            { x: 20, y: 50, z: -30 },
        ];

        const inserted = insertControlPointAfterIndex(controlPoints, 0);

        expect(inserted).toHaveLength(4);
        expect(inserted[0]).toEqual(controlPoints[0]);
        expect(inserted[1]).toEqual({
            x: 5,
            y: 10,
            z: -5,
        });
        expect(inserted[2]).toEqual(controlPoints[1]);
        expect(inserted[3]).toEqual(controlPoints[2]);
    });

    it('subdivides every path segment by inserting midpoint control points', () => {
        const controlPoints = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: -10 },
            { x: 20, y: 20, z: -30 },
        ];

        const subdivided = subdivideControlPointSegments(controlPoints);

        expect(subdivided).toHaveLength(5);
        expect(subdivided[0]).toEqual(controlPoints[0]);
        expect(subdivided[1]).toEqual({
            x: 5,
            y: 0,
            z: -5,
        });
        expect(subdivided[2]).toEqual(controlPoints[1]);
        expect(subdivided[3]).toEqual({
            x: 15,
            y: 10,
            z: -20,
        });
        expect(subdivided[4]).toEqual(controlPoints[2]);
    });

    it('densifies every path segment with multiple evenly spaced control points', () => {
        const controlPoints = [
            { x: 0, y: 0, z: 0 },
            { x: 8, y: 4, z: -8 },
        ];

        const densified = densifyControlPointSegments(controlPoints, 3);

        expect(densified).toHaveLength(5);
        expect(densified[0]).toEqual(controlPoints[0]);
        expect(densified[1]).toEqual({
            x: 2,
            y: 1,
            z: -2,
        });
        expect(densified[2]).toEqual({
            x: 4,
            y: 2,
            z: -4,
        });
        expect(densified[3]).toEqual({
            x: 6,
            y: 3,
            z: -6,
        });
        expect(densified[4]).toEqual(controlPoints[1]);
    });

    it('clamps an individually dragged level between its immediate neighbors', () => {
        const orderedLevelIds = [1, 2, 3, 4];
        const currentPositions = {
            1: 0.10,
            2: 0.20,
            3: 0.30,
            4: 0.40,
        };

        const clampedBackward = moveLevelAlongPath(currentPositions, orderedLevelIds, 3, 0.12);
        expect(clampedBackward[3]).toBeCloseTo(0.201, 6);

        const clampedForward = moveLevelAlongPath(currentPositions, orderedLevelIds, 2, 0.39);
        expect(clampedForward[2]).toBeCloseTo(0.299, 6);
    });

    it('moves a chapter boundary later by compressing the dragged chapter proportionally', () => {
        const orderedLevelIds = [1, 2, 3, 4, 5, 6, 7];
        const currentPositions = {
            1: 0.00,
            2: 0.10,
            3: 0.30,
            4: 0.40,
            5: 0.70,
            6: 0.85,
            7: 1.00,
        };
        const chapterRanges = [
            {
                chapterId: 1,
                startLevelId: 1,
                endLevelId: 2,
                startPosition: 0.00,
                endPosition: 0.30,
            },
            {
                chapterId: 2,
                startLevelId: 3,
                endLevelId: 4,
                startPosition: 0.30,
                endPosition: 0.70,
            },
            {
                chapterId: 3,
                startLevelId: 5,
                endLevelId: 7,
                startPosition: 0.70,
                endPosition: 1.00,
            },
        ];

        const retimed = retimeChapterBoundary(
            currentPositions,
            orderedLevelIds,
            chapterRanges,
            2,
            0.55,
        );

        expect(retimed.resolvedBoundaryPosition).toBeCloseTo(0.55, 6);
        expect(retimed.levelPositionsById[3]).toBeCloseTo(0.55, 6);
        expect(retimed.levelPositionsById[4]).toBeCloseTo(0.5875, 6);
        expect(retimed.levelPositionsById[5]).toBeCloseTo(0.70, 6);
        expect(retimed.levelPositionsById[6]).toBeCloseTo(0.85, 6);
        expect(retimed.levelPositionsById[7]).toBeCloseTo(1.00, 6);
        expect(retimed.diagnostics.compressionUsed).toBe(true);
        expect(retimed.diagnostics.compressedChapterId).toBe(2);
        expect(retimed.diagnostics.localClampUsed).toBe(false);
    });

    it('clamps a later chapter boundary move before it can retime later chapters', () => {
        const orderedLevelIds = [1, 2, 3, 4, 5, 6, 7];
        const currentPositions = {
            1: 0.00,
            2: 0.10,
            3: 0.30,
            4: 0.40,
            5: 0.70,
            6: 0.85,
            7: 1.00,
        };
        const chapterRanges = [
            {
                chapterId: 1,
                startLevelId: 1,
                endLevelId: 2,
                startPosition: 0.00,
                endPosition: 0.30,
            },
            {
                chapterId: 2,
                startLevelId: 3,
                endLevelId: 4,
                startPosition: 0.30,
                endPosition: 0.70,
            },
            {
                chapterId: 3,
                startLevelId: 5,
                endLevelId: 7,
                startPosition: 0.70,
                endPosition: 1.00,
            },
        ];

        const retimed = retimeChapterBoundary(
            currentPositions,
            orderedLevelIds,
            chapterRanges,
            2,
            0.62,
        );

        expect(retimed.resolvedBoundaryPosition).toBeCloseTo(0.56, 6);
        expect(retimed.levelPositionsById[4]).toBeCloseTo(0.595, 6);
        expect(retimed.levelPositionsById[5]).toBeCloseTo(0.70, 6);
        expect(retimed.levelPositionsById[6]).toBeCloseTo(0.85, 6);
        expect(retimed.levelPositionsById[7]).toBeCloseTo(1.0, 6);
        expect(retimed.diagnostics.localClampUsed).toBe(true);
        expect(retimed.diagnostics.localClampSide).toBe('current');
    });

    it('moves a chapter boundary earlier by compressing the previous chapter proportionally', () => {
        const orderedLevelIds = [1, 2, 3, 4, 5, 6, 7];
        const currentPositions = {
            1: 0.00,
            2: 0.12,
            3: 0.24,
            4: 0.36,
            5: 0.45,
            6: 0.70,
            7: 1.00,
        };
        const chapterRanges = [
            {
                chapterId: 1,
                startLevelId: 1,
                endLevelId: 3,
                startPosition: 0.00,
                endPosition: 0.36,
            },
            {
                chapterId: 2,
                startLevelId: 4,
                endLevelId: 5,
                startPosition: 0.36,
                endPosition: 0.70,
            },
            {
                chapterId: 3,
                startLevelId: 6,
                endLevelId: 7,
                startPosition: 0.70,
                endPosition: 1.00,
            },
        ];

        const retimed = retimeChapterBoundary(
            currentPositions,
            orderedLevelIds,
            chapterRanges,
            2,
            0.28,
        );

        expect(retimed.resolvedBoundaryPosition).toBeCloseTo(0.28, 6);
        expect(retimed.levelPositionsById[2]).toBeCloseTo(0.093333, 6);
        expect(retimed.levelPositionsById[3]).toBeCloseTo(0.186667, 6);
        expect(retimed.levelPositionsById[4]).toBeCloseTo(0.28, 6);
        expect(retimed.levelPositionsById[5]).toBeCloseTo(0.45, 6);
        expect(retimed.levelPositionsById[6]).toBeCloseTo(0.70, 6);
        expect(retimed.levelPositionsById[7]).toBeCloseTo(1.00, 6);
        expect(retimed.diagnostics.compressedChapterId).toBe(1);
        expect(retimed.diagnostics.localClampUsed).toBe(false);
    });

    it('clamps an earlier chapter boundary move before it can retime earlier chapters', () => {
        const orderedLevelIds = [1, 2, 3, 4, 5, 6, 7];
        const currentPositions = {
            1: 0.00,
            2: 0.10,
            3: 0.30,
            4: 0.42,
            5: 0.55,
            6: 0.72,
            7: 1.00,
        };
        const chapterRanges = [
            {
                chapterId: 1,
                startLevelId: 1,
                endLevelId: 2,
                startPosition: 0.00,
                endPosition: 0.30,
            },
            {
                chapterId: 2,
                startLevelId: 3,
                endLevelId: 4,
                startPosition: 0.30,
                endPosition: 0.55,
            },
            {
                chapterId: 3,
                startLevelId: 5,
                endLevelId: 7,
                startPosition: 0.55,
                endPosition: 1.00,
            },
        ];

        const retimed = retimeChapterBoundary(
            currentPositions,
            orderedLevelIds,
            chapterRanges,
            3,
            0.20,
        );

        expect(retimed.resolvedBoundaryPosition).toBeCloseTo(0.3875, 6);
        expect(retimed.levelPositionsById[1]).toBeCloseTo(0.0, 6);
        expect(retimed.levelPositionsById[2]).toBeCloseTo(0.10, 6);
        expect(retimed.levelPositionsById[3]).toBeCloseTo(0.30, 6);
        expect(retimed.levelPositionsById[4]).toBeCloseTo(0.342, 6);
        expect(retimed.levelPositionsById[5]).toBeCloseTo(0.3875, 6);
        expect(retimed.levelPositionsById[6]).toBeCloseTo(0.72, 6);
        expect(retimed.levelPositionsById[7]).toBeCloseTo(1.0, 6);
        expect(retimed.diagnostics.localClampUsed).toBe(true);
        expect(retimed.diagnostics.localClampSide).toBe('previous');
    });

    it('keeps the chapter one boundary fixed at level one', () => {
        const orderedLevelIds = [1, 2, 3, 4];
        const currentPositions = {
            1: 0.00,
            2: 0.20,
            3: 0.50,
            4: 1.00,
        };
        const chapterRanges = [
            {
                chapterId: 1,
                startLevelId: 1,
                endLevelId: 2,
                startPosition: 0.00,
                endPosition: 0.50,
            },
            {
                chapterId: 2,
                startLevelId: 3,
                endLevelId: 4,
                startPosition: 0.50,
                endPosition: 1.00,
            },
        ];

        const retimed = retimeChapterBoundary(
            currentPositions,
            orderedLevelIds,
            chapterRanges,
            1,
            0.25,
        );

        expect(retimed.levelPositionsById).toEqual(currentPositions);
        expect(retimed.resolvedBoundaryPosition).toBe(0.0);
        expect(retimed.diagnostics.boundaryFixed).toBe(true);
    });

    it('spreads the levels in one chapter evenly across its current boundaries', () => {
        const orderedLevelIds = [1, 2, 3, 4, 5, 6];
        const currentPositions = {
            1: 0.00,
            2: 0.12,
            3: 0.31,
            4: 0.35,
            5: 0.58,
            6: 0.81,
        };
        const chapterRange = {
            chapterId: 2,
            startLevelId: 3,
            endLevelId: 5,
            startPosition: 0.30,
            endPosition: 0.75,
        };

        const spread = spreadChapterLevelsEvenly(currentPositions, orderedLevelIds, chapterRange);

        expect(spread[1]).toBeCloseTo(0.00, 6);
        expect(spread[2]).toBeCloseTo(0.12, 6);
        expect(spread[3]).toBeCloseTo(0.30, 6);
        expect(spread[4]).toBeCloseTo(0.45, 6);
        expect(spread[5]).toBeCloseTo(0.60, 6);
        expect(spread[6]).toBeCloseTo(0.81, 6);
    });

    it('spreads all chapters using the current chapter boundaries', () => {
        const orderedLevelIds = [1, 2, 3, 4, 5, 6];
        const currentPositions = {
            1: 0.00,
            2: 0.17,
            3: 0.30,
            4: 0.41,
            5: 0.78,
            6: 0.95,
        };
        const chapterRanges = [
            {
                chapterId: 1,
                startLevelId: 1,
                endLevelId: 2,
                startPosition: 0.00,
                endPosition: 0.30,
            },
            {
                chapterId: 2,
                startLevelId: 3,
                endLevelId: 5,
                startPosition: 0.30,
                endPosition: 0.90,
            },
            {
                chapterId: 3,
                startLevelId: 6,
                endLevelId: 6,
                startPosition: 0.90,
                endPosition: 1.00,
            },
        ];

        const spread = spreadAllChapterLevelsEvenly(
            currentPositions,
            orderedLevelIds,
            chapterRanges,
        );

        expect(spread[1]).toBeCloseTo(0.00, 6);
        expect(spread[2]).toBeCloseTo(0.15, 6);
        expect(spread[3]).toBeCloseTo(0.30, 6);
        expect(spread[4]).toBeCloseTo(0.50, 6);
        expect(spread[5]).toBeCloseTo(0.70, 6);
        expect(spread[6]).toBeCloseTo(0.90, 6);
    });

    it('stretches downstream control points after the selected anchor progress', () => {
        const controlPoints = [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 10, z: 0 },
            { x: 0, y: 20, z: 0 },
            { x: 0, y: 30, z: 0 },
        ];

        const stretched = stretchPathControlPoints(controlPoints, 0.5, 0.2);

        expect(stretched[0]).toEqual(controlPoints[0]);
        expect(stretched[1]).toEqual(controlPoints[1]);
        expect(stretched[2].y).toBeCloseTo(20.333333, 6);
        expect(stretched[3].y).toBeCloseTo(33.0, 6);
    });

    it('appends a new tail control point by extrapolating the final segment', () => {
        const controlPoints = [
            { x: 0, y: 0, z: 0 },
            { x: 5, y: 10, z: -15 },
            { x: 15, y: 30, z: -35 },
        ];

        const extended = appendTailControlPoint(controlPoints);

        expect(extended).toHaveLength(4);
        expect(extended[3]).toEqual({
            x: 25,
            y: 50,
            z: -55,
        });
    });

    it('round-trips the authored layout through export and import helpers', () => {
        const serialized = serializeOdysseyLayoutData(ODYSSEY_LAYOUT_DATA);
        const parsed = parseOdysseyLayoutData(serialized);

        expect(parsed).toEqual({
            controlPoints: ODYSSEY_LAYOUT_DATA.controlPoints.map((point) => ({ ...point })),
            levelPositionsById: { ...ODYSSEY_LAYOUT_DATA.levelPositionsById },
        });
    });
});
