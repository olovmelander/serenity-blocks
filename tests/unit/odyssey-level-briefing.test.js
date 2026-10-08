import { describe, expect, it } from 'vitest';
import { LEVEL_CONFIGS, getLevelById } from '../../src/core/odyssey/data/levels.js';
import { getOdysseyLevelBriefing } from '../../src/ui/odyssey/odyssey-level-briefing.js';

const briefing = (next, previous) => getOdysseyLevelBriefing(getLevelById(next), getLevelById(previous));

describe('Odyssey next-orb briefing from effective campaign rules', () => {
    it('explains the first cascade goal without falsely introducing cascade physics or the original seeded board', () => {
        const result = briefing(2, 1);
        expect(result.goal).toBe('Trigger 3 cascades');
        expect(result.changes).toEqual([
            'A cascade counts when falling blocks clear again.',
            '24-row well · starts empty.',
        ]);
        expect(result.rules).toEqual(result.changes);
        expect(result.deadline).toBeNull();
        expect(JSON.stringify(result)).not.toMatch(/enabled|4 rows|infinity/i);
    });

    it('presents the composed first duel and explains frags instead of obsolete solo objectives', () => {
        const result = briefing(4, 3);
        expect(result.goal).toBe('Beat Cinder · First to 7 frags');
        expect(result.changes).toEqual([
            'Clear lines to send attacks; attack knockouts earn frags.',
            'Both boards reset after a knockout.',
        ]);
        expect(result.rules).toEqual(['Clear lines to send attacks; attack knockouts earn frags.']);
        expect(result.deadline).toBeNull();
        expect(JSON.stringify(result)).not.toMatch(/score|seconds|speed boost/i);
    });

    it('exposes the real seeded taller board at the early chapter transition', () => {
        const result = briefing(7, 6);
        expect(result.goal).toBe('Trigger 7 cascades');
        expect(result.changes).toEqual([
            'A cascade counts when falling blocks clear again.',
            '28-row well · 8 rows to dig through.',
        ]);
    });

    it('keeps goal targets separate and does not reannounce unchanged mechanics', () => {
        const result = briefing(3, 2);
        expect(result.goal).toBe('Trigger 4 cascades');
        expect(result.changes).toEqual(['25-row well · 1 row to dig through.']);
        expect(briefing(3, 3).changes).toEqual([]);
    });

    it('shows the failure deadline separately from the primary line target', () => {
        const result = briefing(15, 14);
        expect(result.goal).toBe('Clear 42 lines');
        expect(result.deadline).toBe('Reach the goal within 4:30.');
        expect(result.changes[0]).toBe(result.deadline);
        expect(result.rules).toContain(result.deadline);
        expect(briefing(24, 23).changes[0]).toBe('No time limit on this orb.');
    });

    it('retains a finale deadline, full well setup and score streak rule after the preview', () => {
        const result = briefing(56, 55);
        expect(result.goal).toBe('Score 250,000 points');
        expect(result.changes).toEqual([
            'Reach the goal within 8:00.',
            '100-row well · 30 rows to dig through.',
            'Clears on consecutive pieces raise your score multiplier.',
        ]);
        expect(result.rules).toEqual(result.changes);
    });

    it('prioritizes changed controls and a real deadline while retaining chain and score rules', () => {
        const next = structuredClone(getLevelById(56));
        next.victory.primary = { type: 'combo', target: 4 };
        next.victory.failure.value = 45;
        next.modifiers.active.push('mirror');
        const result = getOdysseyLevelBriefing(next, getLevelById(54));
        expect(result.goal).toBe('Trigger a chain of at least 4 waves');
        expect(result.changes).toEqual([
            'Left and right controls are reversed.',
            'Reach the goal within 45 seconds.',
            'One locked piece must trigger the whole chain; the first clear is wave one.',
        ]);
        expect(result.rules).toContain('Clears on consecutive pieces raise your score multiplier.');
    });

    it('only announces fixed gravity when progression actually changes', () => {
        const previous = getLevelById(1);
        const next = structuredClone(previous);
        next.mechanics.speed.levelProgression = false;
        expect(getOdysseyLevelBriefing(next, previous).changes).toEqual(['Drop speed stays steady.']);
        expect(getOdysseyLevelBriefing(next, next).changes).toEqual([]);
        expect(getOdysseyLevelBriefing(previous, next).changes)
            .toEqual(['Drop speed increases as you clear lines.']);
    });

    it('does not mistake a survival goal or timed star for a failure deadline', () => {
        const next = structuredClone(getLevelById(1));
        next.victory.primary = { type: 'time', target: 60 };
        expect(getOdysseyLevelBriefing(next)).toMatchObject({
            goal: 'Survive 60 seconds', deadline: null,
        });
        expect(getOdysseyLevelBriefing(next).rules).not.toContain('Reach the goal within 60 seconds.');
    });

    it('handles missing or unknown data without invented rules or exposing unknown identifiers', () => {
        for (const value of [null, undefined, {}, { victory: { primary: { type: 'unknown', target: 5 } } }]) {
            expect(getOdysseyLevelBriefing(value)).toEqual({
                goal: 'Complete the level', changes: [], rules: [], deadline: null,
            });
        }
        const malformed = {
            mechanics: { board: { rows: -5 }, speed: {} },
            modifiers: { active: ['future-modifier'] },
            victory: { primary: { type: 'score' }, failure: { type: 'time', value: Infinity } },
        };
        expect(getOdysseyLevelBriefing(malformed).rules).toEqual([]);
        expect(getOdysseyLevelBriefing(null, getLevelById(15)).changes).toEqual([]);
    });

    it('matches starting-row clearance and leaves effective campaign tuning untouched', () => {
        const next = structuredClone(getLevelById(7));
        next.mechanics.board.startingRows = 100;
        expect(getOdysseyLevelBriefing(next).rules).toContain('28-row well · 24 rows to dig through.');
        const before = structuredClone(LEVEL_CONFIGS);
        LEVEL_CONFIGS.forEach((level, index) => {
            const result = getOdysseyLevelBriefing(level, LEVEL_CONFIGS[index - 1]);
            expect(result.changes.length).toBeLessThanOrEqual(3);
            expect(new Set(result.changes).size).toBe(result.changes.length);
            expect(result.rules.every((rule) => typeof rule === 'string')).toBe(true);
            if (level.victory.failure.type === 'time') expect(result.rules).toContain(result.deadline);
        });
        expect(LEVEL_CONFIGS).toEqual(before);
    });
});
