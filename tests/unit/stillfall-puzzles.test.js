/**
 * The Stillfall certifier, first file: the bank as a whole (ids, lessons, the tier unlock
 * rule, every tier certified somewhere), the puzzle rules, and the standard held to tiers
 * 1–6 (tests/unit/helpers/stillfall-certify.js). The later tiers have files of their own so
 * CI certifies them side by side. A rules change (kicks, spawn, gravity, cascade order) that
 * breaks a shipped puzzle fails here or there.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    buildPuzzle, markedBodies, validatePuzzleDefinition, MAX_SUPPLY,
} from '../../src/core/stillfall/stillfall-puzzle.js';
import {
    applyPlacement, boardFor, createRun, failReason, judge, listPlacements,
} from '../../src/core/stillfall/stillfall-sim.js';
import { isStraight } from '../../src/core/stillfall/stillfall-solver.js';
import {
    STILLFALL_PUZZLES, SOLVES_TO_OPEN_NEXT_TIER, TIERS, openPuzzleIds,
} from '../../src/core/stillfall/puzzle-bank.js';
import { CERTIFIED_SHARDS, CERTIFIED_TIER_GROUPS, certifyTiers } from './helpers/stillfall-certify.js';

describe('Stillfall puzzle bank', () => {
    it('holds valid puzzles with unique ids, lessons and stored solutions', () => {
        const ids = STILLFALL_PUZZLES.map((puzzle) => puzzle.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const definition of STILLFALL_PUZZLES) {
            expect(validatePuzzleDefinition(definition), definition.id).toEqual([]);
            expect(definition.lesson, definition.id).toBeTruthy();
            // The panel and the atlas card are laid out for a lesson of two short lines at most.
            expect(definition.lesson.length, definition.id).toBeLessThanOrEqual(101);
            expect(definition.solution?.length, definition.id).toBe(definition.supply.length);
        }
    });

    it('opens a tier once three puzzles in the tier below are solved, so lanterns come first', () => {
        const tierOf = (tier) => STILLFALL_PUZZLES.filter((p) => p.tier === tier).map((p) => p.id);
        const tiers = [...new Set(STILLFALL_PUZZLES.map((p) => p.tier))];
        expect(tiers).toEqual(TIERS.map((entry) => entry.tier));
        expect(SOLVES_TO_OPEN_NEXT_TIER).toBe(3);
        expect([...openPuzzleIds([])]).toEqual(tierOf(1));
        expect([...openPuzzleIds(tierOf(1).slice(0, 2))]).toEqual(tierOf(1));
        // Three in each tier below opens the next one, and only that one.
        for (let index = 1; index < tiers.length; index += 1) {
            const below = tiers.slice(0, index);
            const solved = below.flatMap((tier) => tierOf(tier).slice(0, 3));
            expect([...openPuzzleIds(solved)]).toEqual([...below, tiers[index]].flatMap(tierOf));
            expect([...openPuzzleIds(solved.slice(0, -1))]).toEqual(below.flatMap(tierOf));
        }
        // Any three first-light solves include a lantern puzzle: fewer puzzles go without one.
        const withoutLanterns = STILLFALL_PUZZLES.filter((p) => p.tier === 1 && !p.rows.some((row) => /[a-z]/.test(row)));
        expect(withoutLanterns.length).toBeLessThan(SOLVES_TO_OPEN_NEXT_TIER);
    });

    it('certifies every tier in exactly one certifier file, or a split tier in every one of its shards', () => {
        const groups = CERTIFIED_TIER_GROUPS.flat();
        expect(new Set(groups).size).toBe(groups.length);
        expect(groups.sort((a, b) => a - b)).toEqual(TIERS.map((entry) => entry.tier));
        for (const [tier, count] of Object.entries(CERTIFIED_SHARDS)) {
            expect(CERTIFIED_TIER_GROUPS, `tier ${tier} is split, so it is a group of its own`).toContainEqual([Number(tier)]);
            expect(STILLFALL_PUZZLES.filter((p) => p.tier === Number(tier)).length).toBeGreaterThanOrEqual(count);
            for (let shard = 0; shard < count; shard += 1) {
                const file = new URL(`./stillfall-puzzles-tier-${tier}-${shard + 1}.test.js`, import.meta.url);
                expect(fs.existsSync(file), `${file.pathname} is missing`).toBe(true);
                expect(fs.readFileSync(file, 'utf8')).toContain(`certifyShard(${tier}, ${shard})`);
            }
        }
    });

    certifyTiers(CERTIFIED_TIER_GROUPS[0]);
});

describe('Stillfall rules', () => {
    const definition = {
        id: 'rules', title: 'Rules', rows: ['....R.....', 'AAAAAAAA..'], supply: ['O', 'O'],
    };

    it('rejects malformed definitions with every problem named', () => {
        expect(validatePuzzleDefinition({
            id: 'Bad Id', title: '', rows: ['AAAA', 'BBBBBBBBBB'], supply: Array(MAX_SUPPLY + 1).fill('I'), goal: { type: 'win' },
        })).toEqual(expect.arrayContaining([
            'id must be a short kebab-case string',
            'title is required',
            'row 0 must be 10 characters',
            'row 1 is already full',
            `supply must hold 1–${MAX_SUPPLY} pieces`,
            expect.stringContaining('goal.type must be one of'),
        ]));
        expect(validatePuzzleDefinition({ ...definition, supply: ['Q'], goal: { type: 'clear-all' } }))
            .toEqual(["unknown supply piece 'Q'"]);
        const split = { ...definition, rows: ['A.A.......', 'BBBBBBBB..'], goal: { type: 'clear-all' } };
        expect(validatePuzzleDefinition(split)).toEqual(["body 'A' must be one connected group"]);
        expect(validatePuzzleDefinition({ ...definition, goal: { type: 'relic-floor', body: 'Z' } }))
            .toEqual(['goal.body must name a body in rows']);
        expect(validatePuzzleDefinition({
            ...definition, goal: { type: 'clear-all' }, solution: [{ piece: 'O', rotation: 0, x: 4 }],
        })).toEqual(['solution must list one step per supply piece']);
        expect(validatePuzzleDefinition({
            ...definition,
            goal: { type: 'clear-all' },
            solution: [{ piece: 'I', rotation: 0, x: 4 }, { piece: 'O', rotation: 4, x: 0 }],
        })).toHaveLength(2);
    });

    it('checks seals and goals held together', () => {
        const all = (...of) => ({ ...definition, goal: { type: 'all', of } });
        expect(validatePuzzleDefinition({ ...definition, goal: { type: 'seal', body: 'Z' } }))
            .toEqual(['goal.body must name a body in rows']);
        // A seal may lie in the floor; a relic may not.
        expect(validatePuzzleDefinition({ ...definition, goal: { type: 'seal', body: 'A' } })).toEqual([]);
        expect(validatePuzzleDefinition(all({ type: 'clear-all' }))).toEqual(['goal.of must hold 2–3 goals']);
        expect(validatePuzzleDefinition(all({ type: 'all', of: [] }, { type: 'lines', atLeast: 1 })))
            .toEqual(['goal.of[0] must be a single goal']);
        expect(validatePuzzleDefinition(all({ type: 'lines' }, { type: 'seal', body: 'A' })))
            .toEqual(['goal.of[0]: goal.atLeast must be a positive whole number']);
        expect(validatePuzzleDefinition(all({ type: 'clear-all' }, { type: 'seal', body: 'A' })))
            .toEqual([expect.stringContaining('an empty well cannot go with')]);
        expect(validatePuzzleDefinition(all({ type: 'relic-floor', body: 'R' }, { type: 'seal', body: 'R' })))
            .toEqual(['each marked body may serve one goal']);
        expect(validatePuzzleDefinition(all({ type: 'lines', atLeast: 1 }, { type: 'lines', atLeast: 2 })))
            .toEqual(['only relics and seals may repeat']);
        expect(validatePuzzleDefinition(all({ type: 'relic-floor', body: 'R' }, { type: 'seal', body: 'A' }))).toEqual([]);
        expect(markedBodies(all({ type: 'relic-floor', body: 'R' }, { type: 'seal', body: 'A' }).goal))
            .toEqual({ relics: ['R'], seals: ['A'] });
    });

    it('breaks a seal only when every block of it is gone, and wants both goals after one lock', () => {
        // Clearing the floor takes the seal's long arm; the block above it falls and stays.
        const tall = createRun(buildPuzzle({
            ...definition, rows: ['S.........', 'SSSSSSSSS.'], supply: ['I'], goal: { type: 'seal', body: 'S' },
        }));
        const upright = listPlacements(tall).find((p) => p.footprint === '9,20;9,21;9,22;9,23');
        const after = applyPlacement(tall, upright).run;
        expect(after.lines).toBe(1);
        expect(after.outcome).toBe('failed');
        expect(failReason(after)).toBe('spent');
        const flat = createRun(buildPuzzle({
            ...definition, rows: ['SSSSSSSSS.'], supply: ['I'], goal: { type: 'seal', body: 'S' },
        }));
        expect(applyPlacement(flat, listPlacements(flat).find((p) => p.footprint.includes('9,23'))).run.outcome).toBe('solved');

        const both = buildPuzzle({
            ...definition,
            rows: ['....R.....', 'SS....AAA.'],
            goal: { type: 'all', of: [{ type: 'relic-floor', body: 'R' }, { type: 'seal', body: 'S' }] },
        });
        const run = createRun(both);
        const without = (id) => run.lockedPieces.filter((p) => p.pieceId !== id);
        expect(judge(run)).toBe('open');
        expect(judge({ ...run, lockedPieces: without(both.bodyIds.S) })).toBe('open'); // the relic is still up
        const down = without(both.bodyIds.S).map((p) => (p.pieceId === both.bodyIds.R ? { ...p, y: p.y + 1 } : p));
        expect(judge({ ...run, lockedPieces: down })).toBe('solved');
        const lost = { ...run, lockedPieces: without(both.bodyIds.R) };
        expect(judge(lost)).toBe('failed');
        expect(failReason(lost)).toBe('relic-lost');
    });

    it('never gives touching bodies the same colour', () => {
        for (const bank of STILLFALL_PUZZLES) {
            const grid = boardFor(buildPuzzle(bank).lockedPieces);
            grid.forEach((row, y) => row.forEach((cell, x) => {
                for (const other of [row[x + 1], grid[y + 1]?.[x]]) {
                    if (cell && other && other.id !== cell.id) {
                        expect(other.type, `${bank.id} ${x},${y}`).not.toBe(cell.type);
                    }
                }
            }));
        }
    });

    it('fails a relic goal once the relic is cleared away, and when the supply runs out', () => {
        const puzzle = buildPuzzle({ ...definition, goal: { type: 'relic-floor', body: 'R' } });
        let run = createRun(puzzle);
        expect(judge(run)).toBe('open');
        // Two O pieces into the right-hand gap clear the row and drop the relic one row.
        for (let i = 0; i < 2 && run.outcome === 'open'; i += 1) {
            const placement = listPlacements(run).find((p) => p.footprint.includes('8,23'));
            if (!placement) break;
            ({ run } = applyPlacement(run, placement));
        }
        expect(run.outcome).toBe('solved');
        const spent = createRun(buildPuzzle({ ...definition, supply: ['I'], goal: { type: 'lines', atLeast: 3 } }));
        expect(applyPlacement(spent, listPlacements(spent)[0]).run.outcome).toBe('failed');
    });

    it('tells a straight placement from a tuck', () => {
        const run = createRun(buildPuzzle({ ...definition, goal: { type: 'clear-all' } }));
        const placements = listPlacements(run);
        expect(placements.some(isStraight)).toBe(true);
        const tuck = { ...placements[0], actions: [{ type: 'softDrop' }, { type: 'move', dir: 1 }] };
        expect(isStraight(tuck)).toBe(false);
    });
});
