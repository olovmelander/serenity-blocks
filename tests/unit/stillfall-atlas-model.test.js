/**
 * The Stillfall puzzle atlas as data (stillfall-atlas-model.js), against the real bank: the
 * tiers and their counts, why a tier is shut and what the next one still needs, each
 * puzzle's starting structure as preview cells, and where a key or a pad step lands.
 */
import { describe, expect, it } from 'vitest';
import {
    balancedColumns,
    buildAtlasModel,
    piecesText,
    preferredPuzzle,
    PREVIEW_COLUMNS,
    PREVIEW_ROWS,
    previewCells,
    puzzleLockNote,
    resolveAtlasKey,
    stepPuzzle,
    stepRow,
    stepTier,
    tierLockNote,
    tierNextNote,
    tierOf,
} from '../../src/ui/stillfall/stillfall-atlas-model.js';
import {
    openPuzzleIds, SOLVES_TO_OPEN_NEXT_TIER, STILLFALL_PUZZLES, TIERS,
} from '../../src/core/stillfall/puzzle-bank.js';

/** A state as StillfallMode publishes it: the bank with open and solved, the puzzle on the board. */
function stateFor(solvedIds, puzzleId = STILLFALL_PUZZLES[0].id) {
    const open = openPuzzleIds(solvedIds);
    return {
        puzzle: { id: puzzleId },
        bank: STILLFALL_PUZZLES.map((entry) => ({
            id: entry.id,
            title: entry.title,
            tier: entry.tier,
            open: open.has(entry.id),
            solved: solvedIds.includes(entry.id),
        })),
    };
}

const idsIn = (tier) => STILLFALL_PUZZLES.filter((entry) => entry.tier === tier).map((entry) => entry.id);

describe('the Stillfall atlas model', () => {
    it('lays the bank out as the descent: every tier, every puzzle, the counts the header shows', () => {
        const first = idsIn(1);
        const model = buildAtlasModel(stateFor(first.slice(0, 4), first[4]));
        expect(model.tiers.map((tier) => tier.name)).toEqual(TIERS.map((tier) => tier.name));
        expect(model.total).toBe(STILLFALL_PUZZLES.length);
        expect(model.solved).toBe(4);
        expect(model.tiersOpen).toBe(2);
        const [firstLight, undertow, deepFault] = model.tiers;
        expect(firstLight.status).toBe('open');
        expect(firstLight.current).toBe(true);
        expect(firstLight.pieces).toBe('One piece each');
        expect(undertow.pieces).toBe('Two pieces each');
        expect(deepFault.status).toBe('locked');
        expect(firstLight.puzzles.map((puzzle) => puzzle.number)).toEqual(first.map((_, index) => index + 1));
        expect(model.puzzles.get(first[4])).toMatchObject({ current: true, status: 'open', number: 5 });
        expect(model.puzzles.get(first[0]).status).toBe('solved');
        expect(model.puzzles.get(idsIn(3)[0]).status).toBe('locked');
        // The definition's own data rides along for the card.
        expect(model.puzzles.get(first[0]).lesson).toBe(STILLFALL_PUZZLES[0].lesson);
        expect(model.puzzles.get(first[0]).supply).toEqual(STILLFALL_PUZZLES[0].supply);
    });

    it('says why a tier is shut: the solves it still needs, or the tier it waits behind', () => {
        const first = idsIn(1);
        const none = buildAtlasModel(stateFor([]));
        expect(tierLockNote(none.tiers[1])).toBe(`Solve ${SOLVES_TO_OPEN_NEXT_TIER} in First light to open`);
        expect(tierLockNote(none.tiers[2])).toBe('Opens after Undertow');
        expect(tierLockNote(none.tiers[0])).toBe('');
        const one = buildAtlasModel(stateFor(first.slice(0, 1)));
        expect(tierLockNote(one.tiers[1])).toBe(`Solve ${SOLVES_TO_OPEN_NEXT_TIER - 1} more in First light to open`);
        expect(puzzleLockNote(one, one.tiers[1].puzzles[0]))
            .toBe(`Solve ${SOLVES_TO_OPEN_NEXT_TIER - 1} more in First light to open Undertow.`);
        expect(puzzleLockNote(one, one.tiers[2].puzzles[0])).toBe('Deep fault opens after Undertow.');
    });

    it('counts down the solves the next tier still needs, and drops the count once it opens', () => {
        const first = idsIn(1);
        const none = buildAtlasModel(stateFor([]));
        expect(tierNextNote(none.tiers[0], none.tiers[1]))
            .toBe(`Solve ${SOLVES_TO_OPEN_NEXT_TIER} to open ${TIERS[1].name}`);
        const one = buildAtlasModel(stateFor(first.slice(0, 1)));
        expect(tierNextNote(one.tiers[0], one.tiers[1]))
            .toBe(`Solve ${SOLVES_TO_OPEN_NEXT_TIER - 1} more to open ${TIERS[1].name}`);
        const enough = buildAtlasModel(stateFor(first.slice(0, SOLVES_TO_OPEN_NEXT_TIER)));
        expect(enough.tiers[1].open).toBe(true);
        expect(tierNextNote(enough.tiers[0], enough.tiers[1])).toBe('');
        const all = buildAtlasModel(stateFor(first));
        expect(all.tiers[0].status).toBe('complete');
        expect(tierNextNote(all.tiers[0], all.tiers[1])).toBe('All solved');
        expect(tierNextNote(all.tiers[2], all.tiers[3])).toBe('');
    });

    it('draws a structure bottom-aligned in the shared frame, with seams only where bodies meet', () => {
        const firstFall = STILLFALL_PUZZLES.find((entry) => entry.id === 'first-fall');
        const rows = previewCells(firstFall);
        expect(rows).toHaveLength(PREVIEW_ROWS);
        expect(rows.every((row) => row.length === PREVIEW_COLUMNS)).toBe(true);
        // '.AA.......' over 'BBBBBB.CCC': the last two frame rows.
        expect(rows.slice(0, PREVIEW_ROWS - 2).flat().every((cell) => cell === null)).toBe(true);
        const [top, floor] = rows.slice(-2);
        expect(top.map((cell) => cell?.body ?? '.').join('')).toBe('.AA.......');
        expect(floor.map((cell) => cell?.body ?? '.').join('')).toBe('BBBBBB.CCC');
        // A on B: a seam below A; inside B none; A and B never share a shade.
        expect(top[1].seamBelow).toBe(true);
        expect(floor[0].seamRight).toBe(false);
        expect(top[1].shade).not.toBe(floor[1].shade);
    });

    it('marks the relic and the seal from the goal', () => {
        const relicPuzzle = STILLFALL_PUZZLES.find((entry) => entry.id === 'the-relic');
        const relicCells = previewCells(relicPuzzle).flat().filter(Boolean);
        expect(relicCells.some((cell) => cell.relic && cell.body === relicPuzzle.goal.body)).toBe(true);
        expect(relicCells.filter((cell) => cell.relic).every((cell) => cell.body === relicPuzzle.goal.body)).toBe(true);
        const sealPuzzle = STILLFALL_PUZZLES.find((entry) => entry.goal.type === 'seal');
        const sealCells = previewCells(sealPuzzle).flat().filter(Boolean);
        expect(sealCells.filter((cell) => cell.seal).length).toBeGreaterThan(0);
        expect(sealCells.filter((cell) => cell.seal).every((cell) => cell.body === sealPuzzle.goal.body)).toBe(true);
    });

    it('never gives two touching bodies the same shade, anywhere in the bank', () => {
        STILLFALL_PUZZLES.forEach((puzzle) => {
            const rows = previewCells(puzzle);
            rows.forEach((row, y) => row.forEach((cell, x) => {
                if (!cell) return;
                [row[x + 1], rows[y + 1]?.[x]].forEach((other) => {
                    if (other && other.body !== cell.body) expect(other.shade, puzzle.id).not.toBe(cell.shade);
                });
            }));
        });
    });

    it('opens a tier on the puzzle on the board, else the first one still to solve', () => {
        const first = idsIn(1);
        const model = buildAtlasModel(stateFor(first.slice(0, 3), first[6]));
        expect(preferredPuzzle(tierOf(model, 1)).id).toBe(first[6]);
        expect(preferredPuzzle(tierOf(model, 2)).id).toBe(idsIn(2)[0]);
        const shut = buildAtlasModel(stateFor([]));
        expect(preferredPuzzle(tierOf(shut, 5)).id).toBe(idsIn(5)[0]);
    });

    it('walks the cards across tier seams, the rows by columns, and the tiers by step', () => {
        const model = buildAtlasModel(stateFor([]));
        const first = idsIn(1);
        const second = idsIn(2);
        expect(stepPuzzle(model, first.at(-1), 1).id).toBe(second[0]);
        expect(stepPuzzle(model, second[0], -1).id).toBe(first.at(-1));
        expect(stepPuzzle(model, STILLFALL_PUZZLES[0].id, -1)).toBeNull();
        // First light's ten as five and five: down from 2 is 7; down again runs on into Undertow.
        expect(stepRow(model, first[1], 1, 5).id).toBe(first[6]);
        expect(stepRow(model, first[6], 1, 5).id).toBe(second[1]);
        expect(stepRow(model, second[1], -1, 7).id).toBe(first[8]);
        expect(stepRow(model, first[1], -1, 5)).toBeNull();
        // A shorter last row: Undertow's fourteen in rows of five, down from 10 lands on 14.
        expect(stepRow(model, second[9], 1, 5).id).toBe(second[13]);
        expect(stepRow(model, second[8], 1, 5).id).toBe(second[13]);
        expect(stepTier(model, 1, 1).tier).toBe(2);
        expect(stepTier(model, 1, -1)).toBeNull();
        expect(stepTier(model, 10, 1)).toBeNull();
    });

    it('balances the grid rows', () => {
        expect(balancedColumns(14, 8)).toBe(7);
        expect(balancedColumns(14, 14)).toBe(14);
        expect(balancedColumns(10, 8)).toBe(5);
        expect(balancedColumns(12, 9)).toBe(6);
        expect(balancedColumns(14, 3)).toBe(3);
        expect(balancedColumns(0, 3)).toBe(1);
        expect(balancedColumns(5, 0)).toBe(1);
    });

    it('reads the keys: arrows walk the cards, Page keys the tiers, Enter plays, Escape goes back', () => {
        expect(resolveAtlasKey('ArrowRight', 'card')).toEqual({ across: 1 });
        expect(resolveAtlasKey('ArrowUp', 'card')).toEqual({ row: -1 });
        expect(resolveAtlasKey('Enter', 'card')).toEqual({ play: true });
        // Space is the drop on the board: a habit must never start another puzzle.
        expect(resolveAtlasKey(' ', 'card')).toEqual({ hold: true });
        expect(resolveAtlasKey('Home', 'card')).toEqual({ edge: 'first' });
        expect(resolveAtlasKey('PageDown', 'card')).toEqual({ tier: 1, focus: 'card' });
        expect(resolveAtlasKey('ArrowDown', 'tab')).toEqual({ tier: 1, focus: 'tab' });
        expect(resolveAtlasKey('ArrowRight', 'tab')).toEqual({ focus: 'card' });
        expect(resolveAtlasKey('Enter', 'tab')).toEqual({ focus: 'card' });
        expect(resolveAtlasKey('Escape', 'other')).toEqual({ close: true });
        // On a button, Enter is the button's own; an arrow brings focus back to the cards.
        expect(resolveAtlasKey('Enter', 'other')).toBeNull();
        expect(resolveAtlasKey('ArrowLeft', 'other')).toEqual({ focus: 'card' });
        expect(resolveAtlasKey('x', 'card')).toBeNull();
    });

    it('names the supply plainly', () => {
        expect(piecesText([1, 1])).toBe('One piece each');
        expect(piecesText([3])).toBe('Three pieces each');
        expect(piecesText([3, 4, 3])).toBe('Three to four pieces');
        expect(piecesText([])).toBe('');
    });
});
