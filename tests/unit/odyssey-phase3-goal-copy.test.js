import { describe, expect, it } from 'vitest';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import { hasOdysseyTimeBoard, isOdysseyTimeBoardRun } from '../../src/core/odyssey/odyssey-time-board.js';
import {
    describeOdysseyStarOutcome, formatOdysseyMapObjective, formatOdysseyStarCondition, getOdysseyRetryDebrief,
} from '../../src/ui/odyssey/objective-copy.js';
import { getOdysseyLevelBriefing } from '../../src/ui/odyssey/odyssey-level-briefing.js';

// Phase 3's goals (level design audit 2026-11) as the player reads them, and the data rules that keep them sound.
const validate = (level) => new LevelRegistry().validateLevel(level);

describe('dig out N rubble rows', () => {
    it('names the goal, its stars and its shortfall in rows', () => {
        expect(formatOdysseyMapObjective({ type: 'rubble', target: 6 })).toBe('Dig out 6 rubble rows');
        expect(formatOdysseyMapObjective({ type: 'rubble', target: 1 })).toBe('Dig out 1 rubble row');
        expect(formatOdysseyStarCondition({ rubbleCleared: 6 }, 0)).toBe('Clear the orb');
        expect(formatOdysseyStarCondition({ rubbleCleared: 6, time: 60 }, 2)).toBe('6 rubble rows + Under 1 min');
        const level = { victory: { primary: { type: 'rubble', target: 6 } }, modifiers: { active: [] } };
        expect(getOdysseyRetryDebrief(level, { rubbleCleared: 4 }, 'top-out')).toMatchObject({
            objective: 'Dig out 6 rubble rows',
            progressLabel: '4 / 6 rubble rows',
            remainingText: '2 rubble rows short of the goal.',
        });
    });

    it('briefs the rule once the well has rubble', () => {
        const level = getLevelById(8);
        const briefing = getOdysseyLevelBriefing(level);
        expect(briefing.goal).toBe('Dig out 6 rubble rows');
        expect(briefing.rules).toContain(
            'Rubble rows have gaps: clear the rows above them, then fill the gaps to break each row.',
        );
    });

    it('never asks for more rows than the orb starts with', () => {
        const level = structuredClone(getLevelById(8));
        expect(validate(level).errors).toEqual([]);
        level.victory.primary.target = 7;
        expect(validate(level).errors).toContain('Rubble goal asks for more rows than the orb starts with');
    });
});

describe('survive N seconds', () => {
    it('names survival stars as a time to reach, and reads them from the time survived', () => {
        expect(formatOdysseyMapObjective({ type: 'time', target: 90 })).toBe('Survive 90 seconds');
        expect(formatOdysseyStarCondition({ survived: 150 }, 1)).toBe('Survive 2:30');
        expect(formatOdysseyStarCondition({ survived: 180 }, 2)).toBe('Survive 3 minutes');
        const level = getLevelById(39);
        const outcome = describeOdysseyStarOutcome(level, { stars: 1, time: 120 });
        expect(outcome.next.missed).toEqual([expect.objectContaining({ key: 'survived', met: false, actual: '2:00' })]);
    });

    it('briefs survival as a goal to reach and then play on', () => {
        expect(getOdysseyLevelBriefing(getLevelById(39)).rules).toContain('Stay alive until the timer reaches the '
            + 'goal, then keep going: every extra second counts toward your stars.');
    });

    it('asks for longer than the goal only with a lap to play on, and only on a survival goal', () => {
        const level = structuredClone(getLevelById(39));
        expect(level.victoryLapPolicy).toBe('showcase');
        expect(validate(level).errors).toEqual([]);
        expect(validate({ ...level, victoryLapPolicy: 'none' }).errors)
            .toContain('two-star survival time exceeds the goal without a victory lap');
        const lines = structuredClone(getLevelById(1));
        lines.stars.two = { lines: 20, survived: 60 };
        expect(validate(lines).errors).toContain('two-star survival time needs a survival goal');
    });

    it('keeps survival off the fastest-first time board, and charmed runs off every time board', () => {
        const survival = getLevelById(39);
        const lines = getLevelById(1);
        expect(hasOdysseyTimeBoard(survival)).toBe(false);
        expect(isOdysseyTimeBoardRun(survival, { charms: [] })).toBe(false);
        expect(isOdysseyTimeBoardRun(lines, { charms: [] })).toBe(true);
        expect(isOdysseyTimeBoardRun(lines, { charms: ['long-breath'] })).toBe(false);
    });
});
