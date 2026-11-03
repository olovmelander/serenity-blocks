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
            '24-row well · 3 rows set up for you.',
        ]);
        expect(result.rules).toEqual(result.changes);
        expect(result.deadline).toBeNull();
        expect(JSON.stringify(result)).not.toMatch(/enabled|4 rows|infinity/i);
    });

    it('presents the composed first duel and explains knockouts instead of obsolete solo objectives', () => {
        const result = briefing(5, 4);
        expect(result.goal).toBe('Defeat Cinder · First to 3 knockouts');
        const attack = 'Clear two or more lines with one piece to send attack rows. '
            + 'Topping out the rival with an attack scores a knockout.';
        expect(result.changes).toEqual([attack, 'Both wells reset after every top-out.']);
        expect(result.rules).toEqual([attack]);
        expect(result.deadline).toBeNull();
        expect(JSON.stringify(result)).not.toMatch(/points|seconds|speed boost/i);
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
        const result = briefing(55, 54);
        expect(result.goal).toBe(`Score ${(160000).toLocaleString()} points`);
        expect(result.changes).toEqual([
            'Reach the goal within 10:00.',
            '100-row well · 30 rows to dig through.',
            'Clears on consecutive pieces raise your score multiplier.',
        ]);
        expect(result.rules).toEqual(result.changes);
    });

    it('prioritizes changed controls and a real deadline while retaining chain and score rules', () => {
        const next = structuredClone(getLevelById(55));
        next.victory.primary = { type: 'combo', target: 4 };
        next.victory.failure.value = 45;
        next.modifiers.active.push('mirror');
        // Orb 52 plays unmirrored (orb 53 is the mirrored orb since the level design audit 2026-11).
        const result = getOdysseyLevelBriefing(next, getLevelById(52));
        expect(result.goal).toBe('Trigger a chain of at least 4 waves');
        expect(result.changes).toEqual([
            'Left and right controls are reversed.',
            'Reach the goal within 45 seconds.',
            'One locked piece must trigger the whole chain; the first clear is wave one.',
        ]);
        expect(result.rules).toContain('Clears on consecutive pieces raise your score multiplier.');
    });

    it('announces the mirrored controls on Murmuration and their return after it', () => {
        expect(briefing(53, 52).changes[0]).toBe('Left and right controls are reversed.');
        expect(briefing(53, 52).rules).toContain('Left and right controls are reversed.');
        expect(briefing(54, 53).rules).not.toContain('Left and right controls are reversed.');
    });

    it('names a Quad goal in Quads and explains what a Quad is', () => {
        const result = briefing(12, 11);
        expect(result.goal).toBe('Clear 3 Quads');
        expect(result.rules)
            .toContain('A Quad is four lines cleared by one piece: leave one column open for a long I piece.');
        // Its prepared opening (phase 2) is set up for the player, not rubble to dig through.
        expect(result.rules).toContain('20-row well · 4 rows set up for you.');
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
                goal: 'Clear the orb', changes: [], rules: [], deadline: null,
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
