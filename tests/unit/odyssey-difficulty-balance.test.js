import { describe, expect, it } from 'vitest';
import { COLS } from '../../src/core/constants.js';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { CHAPTER_CONFIGS } from '../../src/core/odyssey/data/chapters.js';
import { LEVEL_CONFIGS, getLevelById } from '../../src/core/odyssey/data/levels.js';

function getLevel(id) {
    const level = getLevelById(id);
    expect(level).toBeTruthy();
    return level;
}

function countOccupiedCells(boardGrid) {
    return boardGrid.reduce(
        (total, row) => total + row.filter(Boolean).length,
        0,
    );
}

describe('Odyssey difficulty balance', () => {
    it('applies the derived model without replacing authored objective types or finale outliers', () => {
        const firstSprint = getLevel(4);
        expect(firstSprint.metadata.difficultyModel.scalar).toBeCloseTo(0.211, 3);
        expect(firstSprint.mechanics.speed.startLevel).toBe(3);
        expect(firstSprint.victory.primary).toEqual({ type: 'lines', target: 22 });
        expect(firstSprint.victory.failure).toEqual({ type: 'time', value: 270 });

        const chapterOneBoss = getLevel(5);
        expect(chapterOneBoss.mechanics.baseMode).toBe('hybrid');
        expect(chapterOneBoss.victory.primary.type).toBe('lines');
        expect(chapterOneBoss.victory.primary.target).toBe(40);
        expect(chapterOneBoss.stars.three).toEqual({ lines: 40, cascades: 3, bonuses: 1 });

        const finale = getLevel(51);
        expect(finale.metadata.difficultyModel.scalar).toBe(1);
        expect(finale.mechanics.baseMode).toBe('infinity');
        expect(finale.mechanics.board.rows).toBe(100);
        expect(finale.mechanics.board.startingRows).toBe(30);
        expect(finale.mechanics.speed.fixedDropInterval).toBe(500);
        expect(finale.victory.primary).toEqual({ type: 'score', target: 250000 });
    });

    it('keeps chapter 6 and chapter 7 peaks hard while adding release space around them', () => {
        const eventHorizon = getLevel(42);
        const singularityGate = getLevel(43);
        const singularity = getLevel(44);
        expect(singularityGate.role).toBe('release');
        expect(singularityGate.emotionalBeat).toBe('release');
        expect(singularityGate.victory.failure.type).toBe('top-out');
        expect(singularityGate.mechanics.speed.startLevel).toBeLessThan(eventHorizon.mechanics.speed.startLevel);
        expect(singularityGate.metadata.difficulty).toBeLessThan(singularity.metadata.difficulty);

        const voltageStorm = getLevel(48);
        const chromaticImpasto = getLevel(49);
        expect(voltageStorm.victory.failure.type).toBe('top-out');
        expect(voltageStorm.modifiers.active).not.toContain('time-attack');
        expect(voltageStorm.victory.primary.target).toBeLessThan(25);
        expect(chromaticImpasto.victory.primary.target).toBe(60);
        expect(chromaticImpasto.victory.failure.value).toBe(180);
        expect(chromaticImpasto.mechanics.speed.startLevel).toBe(12);
    });

    it('maintains an increasing main-arc chapter peak curve with explicit release beats', () => {
        const mainArcLevels = LEVEL_CONFIGS.filter((level) => level.id <= 51);
        const peaks = new Map();
        for (const level of mainArcLevels) {
            const currentPeak = peaks.get(level.chapter) || 0;
            peaks.set(level.chapter, Math.max(currentPeak, level.metadata.difficultyModel.scalar));
        }

        expect(peaks.get(1)).toBeLessThan(peaks.get(2));
        expect(peaks.get(2)).toBeLessThan(peaks.get(3));
        expect(peaks.get(3)).toBeLessThan(peaks.get(4));
        expect(peaks.get(4)).toBeLessThan(peaks.get(5));
        expect(peaks.get(5)).toBeLessThan(peaks.get(6));
        expect(peaks.get(7)).toBeGreaterThanOrEqual(peaks.get(6));

        for (const chapter of [2, 3, 4, 5, 6, 7]) {
            expect(mainArcLevels.some((level) => level.chapter === chapter && level.role === 'release')).toBe(true);
        }
    });

    it('keeps chapter arcBeats in sync with the live role tags that drive the model', () => {
        for (const chapter of CHAPTER_CONFIGS) {
            const [start, end] = chapter.levelRange;
            for (let id = start; id <= end; id++) {
                const level = LEVEL_CONFIGS.find((entry) => entry.id === id);
                expect(level, `level ${id} exists`).toBeTruthy();
                expect(level.role, `Ch${chapter.id} L${id} arcBeats vs role`).toBe(chapter.arcBeats[id - start]);
            }
        }
    });

    it('keeps star tiers monotonic on the primary objective metric for every level', () => {
        const METRIC = {
            cascade: 'cascades', lines: 'lines', score: 'score', combo: 'combo', tetrises: 'tetrises', time: 'time', height: 'height',
        };
        for (const level of LEVEL_CONFIGS) {
            const victoryType = level.victory?.primary?.type;
            const metric = METRIC[victoryType] || victoryType;
            const { one = {}, two = {}, three = {} } = level.stars || {};
            const v1 = one[metric];
            const v2 = two[metric];
            const v3 = three[metric];

            // Higher tiers must demand at least as much of the primary objective metric.
            if (v1 != null && v2 != null) expect(v2, `L${level.id} two.${metric} >= one.${metric}`).toBeGreaterThanOrEqual(v1);
            if (v2 != null && v3 != null) expect(v3, `L${level.id} three.${metric} >= two.${metric}`).toBeGreaterThanOrEqual(v2);
            if (v1 != null && v3 != null) expect(v3, `L${level.id} three.${metric} >= one.${metric}`).toBeGreaterThanOrEqual(v1);

            // A higher tier must not drop a primary metric a lower tier already requires.
            if (v1 != null) expect(v2, `L${level.id} two keeps ${metric}`).not.toBeUndefined();
            if (v2 != null) expect(v3, `L${level.id} three keeps ${metric}`).not.toBeUndefined();

            // Time is lower-is-better: higher tiers must not allow more time.
            const { time: t1 } = one;
            const { time: t2 } = two;
            const { time: t3 } = three;
            if (t1 != null && t2 != null) expect(t2, `L${level.id} two.time <= one.time`).toBeLessThanOrEqual(t1);
            if (t2 != null && t3 != null) expect(t3, `L${level.id} three.time <= two.time`).toBeLessThanOrEqual(t2);
        }
    });

    it('turns startingRows into live seeded rows for Odyssey game states', () => {
        const level = getLevel(6);
        const engine = new GameplayHybridEngine();
        engine.configure(level);

        const gameState = engine.createGameState();
        const { startingRows } = level.mechanics.board;
        const bottomRows = gameState.boardGrid.slice(-startingRows);

        expect(gameState.lockedPieces).toHaveLength(startingRows);
        expect(countOccupiedCells(gameState.boardGrid)).toBeGreaterThan(startingRows * 5);
        expect(countOccupiedCells(gameState.boardGrid)).toBeLessThan(startingRows * COLS);
        expect(bottomRows.every((row) => row.some(Boolean) && row.some((cell) => cell === null))).toBe(true);
        expect(gameState.isGameOver).toBe(false);
    });
});
