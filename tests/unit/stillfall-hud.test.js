/**
 * The Stillfall panel's words: what a miss says and offers. The panel itself is checked in
 * the running game; these are the parts it is built from. What the puzzle atlas says about
 * the tiers is in stillfall-atlas-model.test.js.
 */
import { describe, expect, it } from 'vitest';
import {
    failureTitle, goalText, outcomeHtml, supplyStripHtml,
} from '../../src/ui/stillfall/stillfall-hud.js';
import { NEXT_QUEUE_SLOTS } from '../../src/ui/next-queue-ui.js';
import { PIECE_ROWS, pieceGlyphHtml, shapeOutline } from '../../src/ui/stillfall/stillfall-piece-glyphs.js';

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

    it('names a seal and two goals at once in one sentence', () => {
        const relic = { type: 'relic-floor', body: 'R' };
        const seal = { type: 'seal', body: 'S' };
        expect(goalText(seal)).toBe('Break the seal');
        expect(goalText({ type: 'all', of: [relic, seal] })).toBe('Bring the relic to the floor and break the seal');
        expect(goalText({ type: 'all', of: [relic, { type: 'relic-floor', body: 'Q' }] })).toBe('Bring both relics to the floor');
        expect(goalText({ type: 'all', of: [seal, { type: 'seal', body: 'T' }] })).toBe('Break both seals');
        expect(goalText({ type: 'all', of: [seal, { type: 'waves', atLeast: 3 }] }))
            .toBe('Set off a cascade 3 waves deep and break the seal');
        expect(goalText({ type: 'all', of: [{ type: 'lines', atLeast: 4 }, relic, seal] }))
            .toBe('Clear 4 lines, bring the relic to the floor and break the seal');
    });

    it('says what each goal still lacks after a miss', () => {
        const seal = { type: 'seal', body: 'S' };
        const parts = (...list) => ({ parts: list });
        expect(failureTitle(failed(seal, { lines: 1, ...parts({ ...seal, met: false, cellsLeft: 3 }) })))
            .toBe('The seal still holds 3 blocks.');
        const both = { type: 'all', of: [{ type: 'waves', atLeast: 3 }, { type: 'relic-floor', body: 'R' }] };
        expect(failureTitle(failed(both))).toBe('Nothing cleared.');
        expect(failureTitle(failed(both, {
            lines: 2, bestWaves: 1, ...parts({ ...both.of[0], met: false }, { ...both.of[1], met: false }),
        }))).toBe('2 waves short. The relic is still up.');
        const relics = { type: 'all', of: [{ type: 'relic-floor', body: 'R' }, { type: 'relic-floor', body: 'Q' }] };
        expect(failureTitle(failed(relics, {
            lines: 1, ...parts({ ...relics.of[0], met: true }, { ...relics.of[1], met: false }),
        }))).toBe('A relic is still up.');
        expect(failureTitle(failed(relics, { reason: 'relic-lost' }))).toBe('A relic was cleared away.');
        const seals = { type: 'all', of: [seal, { type: 'seal', body: 'T' }] };
        expect(failureTitle(failed(seals, {
            lines: 1,
            ...parts({ ...seal, met: false, cellsLeft: 2 }, {
                type: 'seal', body: 'T', met: false, cellsLeft: 1,
            }),
        }))).toBe('The seals still hold 3 blocks.');
    });

    it('offers one way back from a miss: try again with one piece, take back with more', () => {
        const one = outcomeHtml(failed({ type: 'lines', atLeast: 1 }));
        expect(one).toContain('data-stillfall-action="retry"');
        expect(one).toContain('Try again');
        expect(outcomeHtml(failed({ type: 'lines', atLeast: 1 }, {}, ['I', 'O', 'T']))).toContain('Take back');
    });

    it('shows the whole supply when the queue cannot: placed pieces dimmed, the one in hand lit', () => {
        const playing = (supply, dealt, inHand = supply[dealt] ?? null) => ({
            puzzle: {
                id: 'p', title: 'P', lesson: '', goal: { type: 'lines', atLeast: 1 }, supply,
            },
            dealt,
            inHand,
        });
        // The piece in hand and the queue's slots show four; the queue says it all.
        expect(NEXT_QUEUE_SLOTS).toBe(3);
        expect(supplyStripHtml(playing(['I', 'O', 'T', 'S'], 0))).toBe('');
        const strip = supplyStripHtml(playing(['T', 'S', 'T', 'O', 'L'], 2));
        const places = [...strip.matchAll(/stillfall-supply__piece (is-[a-z-]+)/g)].map((match) => match[1]);
        expect(places).toEqual(['is-placed', 'is-placed', 'is-in-hand', 'is-coming', 'is-coming']);
        expect(strip).toContain('aria-label="The pieces, in order: T, S, T, O, L"');
        // Spent, nothing is in hand.
        const spent = supplyStripHtml(playing(['T', 'S', 'T', 'O', 'L'], 5));
        expect(spent.match(/is-placed/g)).toHaveLength(5);
    });

    it('draws each piece as one solid shape, the outline of its four cells', () => {
        const inside = (corners, px, py) => {
            let hit = false;
            corners.forEach(([x1, y1], i) => {
                const [x2, y2] = corners[(i + 1) % corners.length];
                if ((y1 > py) !== (y2 > py) && px < x1 + ((py - y1) * (x2 - x1)) / (y2 - y1)) hit = !hit;
            });
            return hit;
        };
        const sides = {
            I: 4, O: 4, T: 8, S: 8, Z: 8, J: 6, L: 6,
        };
        for (const [key, rows] of Object.entries(PIECE_ROWS)) {
            const corners = shapeOutline(rows);
            expect(corners, key).toHaveLength(sides[key]);
            const area = Math.abs(corners.reduce((sum, [x1, y1], i) => {
                const [x2, y2] = corners[(i + 1) % corners.length];
                return sum + x1 * y2 - x2 * y1;
            }, 0)) / 2;
            expect(area, key).toBe(4);
            rows.forEach((row, y) => [...row].forEach((mark, x) => {
                expect(inside(corners, x + 0.5, y + 0.5), `${key} ${x},${y}`).toBe(mark === '#');
            }));
            // One polygon, never a square per cell.
            const html = pieceGlyphHtml(key, 'glyph');
            expect(html.match(/<polygon /g), key).toHaveLength(1);
            expect(html).not.toContain('<i');
        }
    });
});
