/**
 * The Stillfall panel's words: what a miss says and offers, and what the puzzle list says
 * about the next tier. The panel itself is checked in the running game; these are the parts
 * it is built from.
 */
import { describe, expect, it } from 'vitest';
import { bankHtml, failureTitle, outcomeHtml } from '../../src/ui/stillfall/stillfall-hud.js';
import {
    openPuzzleIds, SOLVES_TO_OPEN_NEXT_TIER, STILLFALL_PUZZLES, TIERS,
} from '../../src/core/stillfall/puzzle-bank.js';

const failed = (goal, extra = {}, supply = ['I']) => ({
    puzzle: {
        id: 'p', title: 'P', lesson: '', goal, supply,
    },
    outcome: 'failed',
    reason: 'spent',
    lines: 0,
    bestWaves: 0,
    cellsLeft: 4,
    ...extra,
});

function bankFor(solvedIds) {
    const open = openPuzzleIds(solvedIds);
    return STILLFALL_PUZZLES.map((entry) => ({
        id: entry.id,
        title: entry.title,
        tier: entry.tier,
        open: open.has(entry.id),
        solved: solvedIds.includes(entry.id),
    }));
}

describe('Stillfall panel', () => {
    it('says what a miss fell short of, not the count the goal row already shows', () => {
        expect(failureTitle(failed({ type: 'lines', atLeast: 1 }))).toBe('Nothing cleared.');
        expect(failureTitle(failed({ type: 'lines', atLeast: 3 }, { lines: 2 }))).toBe('1 line short.');
        expect(failureTitle(failed({ type: 'waves', atLeast: 4 }, { lines: 3, bestWaves: 2 }))).toBe('2 waves short.');
        expect(failureTitle(failed({ type: 'clear-all' }))).toBe('The well is not empty.');
        expect(failureTitle(failed({ type: 'relic-floor', body: 'r' }))).toBe('The relic is still up.');
        const blocked = failed({ type: 'lines', atLeast: 1 }, { reason: 'blocked' });
        expect(failureTitle(blocked)).toBe('The next piece has no room.');
        const lost = failed({ type: 'relic-floor', body: 'r' }, { reason: 'relic-lost' });
        expect(failureTitle(lost)).toBe('The relic was cleared away.');
    });

    it('offers one way back from a miss: try again with one piece, take back with more', () => {
        const one = outcomeHtml(failed({ type: 'lines', atLeast: 1 }));
        expect(one).toContain('data-stillfall-action="retry"');
        expect(one).toContain('Try again');
        expect(outcomeHtml(failed({ type: 'lines', atLeast: 1 }, {}, ['I', 'O', 'T']))).toContain('Take back');
    });

    it('counts down the solves the next tier still needs, and drops the count once it opens', () => {
        const first = STILLFALL_PUZZLES.filter((entry) => entry.tier === TIERS[0].tier).map((entry) => entry.id);
        const one = bankHtml({ puzzle: { id: first[0] }, bank: bankFor(first.slice(0, 1)) });
        const countdown = `${SOLVES_TO_OPEN_NEXT_TIER - 1} more to open ${TIERS[1].name}`;
        expect(one).toContain(`1 of ${first.length} solved · ${countdown}`);
        const enough = bankHtml({ puzzle: { id: first[0] }, bank: bankFor(first.slice(0, SOLVES_TO_OPEN_NEXT_TIER)) });
        expect(enough).toContain(`${SOLVES_TO_OPEN_NEXT_TIER} of ${first.length} solved</span>`);
        expect(enough).not.toContain(`more to open ${TIERS[1].name}`);
    });
});
