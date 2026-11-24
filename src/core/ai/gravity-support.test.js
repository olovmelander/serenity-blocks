import { describe, expect, it } from 'vitest';
import { resolveCascade } from '../cascade-resolver.js';
import { GravityBotController } from './gravity-bot-controller.js';
import { gravityLandings } from './gravity-search.js';
import {
    examples, playPosition, position, receivingFloor,
} from '../../../reports/gravity-bot-rebuild/support-positions.mjs';

describe('visible support and release choices', () => {
    const shelfCases = ['build', 'alternatePreview', 'mirror', 'fourDeep'];
    it.each(shelfCases)('creates and loads a shelf before its forecast fires on %s', async (name) => {
        const [roof, load, fire] = await playPosition(examples[name]);
        const mirrored = name === 'mirror';
        const floorDepth = name === 'fourDeep' ? 4 : 2;
        const shelf = mirrored ? '..########' : '########..';
        const parked = mirrored ? '.........#' : '#.........';
        expect(roof.board[0]).toBe(shelf);
        expect(load.board.slice(0, 5)).toEqual([...Array(4).fill(parked), shelf]);
        expect(roof.actual).toEqual([]);
        expect(load.actual).toEqual([]);
        expect(roof.forecast).toHaveLength(2);
        const [second, third] = roof.forecast;
        for (const [forecast, lock] of [[second, load], [third, fire]]) {
            expect(lock).toMatchObject(forecast);
            expect(lock.actual).toEqual(forecast.predicted);
        }
        expect(fire.actual).toEqual([1, floorDepth]);
        expect(fire.clearedFloorRows[0]).toEqual([floorDepth + 1]);
        expect(fire.attack).toBe(floorDepth);
        expect(fire.projectedAttack).toBe(fire.attack);
        expect(fire.lost).toBe(false);
    });

    it.each([
        {
            name: 'parkedSquare',
            parked: ['##........', '##........'],
            floor: [1, 2],
            settled: ['.........#', '.........#'],
            score: 1195,
        },
        {
            name: 'parkedElbow',
            parked: ['##........', '.#........', '.#........'],
            floor: [1, 2, 3],
            settled: ['........##'],
            score: 1745,
        },
    ])('forecasts the parked shape and fits it into the receiving rows on $name', async ({
        name, parked, floor, settled, score,
    }) => {
        const [roof, load, trigger] = await playPosition(examples[name]);
        expect(roof.actual).toEqual([]);
        expect(load.actual).toEqual([]);
        expect(load.board).toEqual([...parked, ...roof.board]);
        expect(roof.board[0]).toBe('########..');
        expect(roof.forecast).toHaveLength(2);
        expect(load).toMatchObject(roof.forecast[0]);
        expect(trigger).toMatchObject(roof.forecast[1]);
        expect(trigger.predicted).toEqual(trigger.actual);
        expect(trigger.actual).toEqual([1, floor.length]);
        expect(trigger.clearedFloorRows).toEqual([[floor.length + 1], floor]);
        expect(trigger.attack).toBe(floor.length);
        expect(trigger.board).toEqual(settled);
        expect(roof.score + load.score + trigger.score).toBe(score);
    });

    it('extends a live release in safety and takes the smaller shot before a lethal rise', async () => {
        const [extension, , payoff] = await playPosition(examples.extend);
        const [shot] = await playPosition(examples.triggerUnderPressure);
        expect(extension.preview).toEqual(shot.preview);
        expect(extension.actual).toEqual([]);
        expect(extension.forecast.at(-1).predicted).toEqual([1, 2]);
        expect(payoff.actual).toEqual([1, 2]);
        expect(payoff.attack).toBe(2);
        expect(shot.actual).toEqual([1, 1]);
        expect(shot.attack).toBe(1);
        expect(shot.lost).toBe(false);

        // Force the dry decision but apply the same real garbage at the same spawn. Waiting lost
        // the game while arriving rows could top a player out. It no longer does (ADR-0024), so
        // the smaller shot above is an answer to the old rule.
        const waiting = { ...examples.triggerUnderPressure, options: { pendingRows: () => 0 } };
        const [late] = await playPosition({ ...waiting, rules: 'pre-versus' });
        expect(late.inputs).toEqual(extension.inputs);
        expect(late.lost).toBe(true);
        const [shippedLate] = await playPosition({ ...waiting, rules: 'shipped' });
        expect(shippedLate.lost).toBe(false);
    });

    it('digs on the observed board after the 18-row burst', async () => {
        const [avoidOverflow, dig] = await playPosition(examples.recover);
        expect(avoidOverflow.actual).toEqual([2]);
        expect(avoidOverflow.board.slice(-18)).toEqual(Array(18).fill('#########.'));
        expect(avoidOverflow.lost).toBe(false);
        expect(dig.pending).toBe(0);
        expect(dig.actual).toEqual([4]);
        expect(dig.board).toEqual(avoidOverflow.board.slice(0, -4));
        expect(dig.lost).toBe(false);
    });

    it('takes the immediate one-row send when the receiving board has no headroom', async () => {
        const [shot] = await playPosition({ ...examples.finish, rules: 'pre-versus' });
        expect(shot.actual).toEqual([2]);
        expect(shot.attack).toBe(1);
        expect(shot.receiverTopOut).toBe(true);
        // The receiver's column stands at the wall. Under the shipped rules it spills over the
        // top and the next piece still appears: the same send ends nobody (ADR-0024).
        const [shipped] = await playPosition({ ...examples.finish, rules: 'shipped' });
        expect(shipped.attack).toBe(1);
        expect(shipped.receiverTopOut).toBe(false);
    });

    it('uses only visible previews and queued row count at the first lock', async () => {
        const [first] = await playPosition({ ...examples.build, locks: 1 });
        const [changedBag] = await playPosition({
            ...examples.build, locks: 1, pieces: [...examples.build.pieces, 'Z', 'Z', 'Z', 'Z'],
        });
        expect(changedBag.inputs).toEqual(first.inputs);
        expect(changedBag.forecast).toEqual(first.forecast);
        const [leftHole] = await playPosition({ ...examples.recover, locks: 1, holeMask: 512 });
        const [rightHole] = await playPosition({ ...examples.recover, locks: 1, holeMask: 1 });
        expect(leftHole.inputs).toEqual(rightHole.inputs);
        expect(leftHole.forecast).toEqual(rightHole.forecast);
        expect(leftHole.board).not.toEqual(rightHole.board);
    });

    it('needs a reachable trigger on the loaded board', () => {
        const rows = [...Array(4).fill('A.........'), 'MMMMKKKK..', ...receivingFloor.slice(1)];
        for (const [piece, depth] of [['J', 2], ['I', 0]]) {
            const state = position(rows, [piece]);
            try {
                const landings = gravityLandings(state.boardGrid, state.currentPiece);
                const depths = landings.map((landing) => resolveCascade([
                    ...state.lockedPieces, { ...landing, pieceId: 'trigger', shapeKey: piece },
                ]).cascadeCount);
                expect(Math.max(...depths)).toBe(depth);
            } finally {
                state.reset();
            }
        }
    });

    it.each([['J', 'O', 1], ['O', 'J', 0]])('keeps the immediate %s release when a later %s can earn the same two waves', (first, later, rotation) => {
        // A rests on K above the garbage hole. The I completes the left half of
        // the shelf. Either J or O can then release A from the right edge.
        const state = position(['....A.....', '....KKKK..', 'GGGG.GGGGG'], ['I', first, later, 'I']);
        try {
            for (const cell of state.boardGrid.at(-1)) if (cell) cell.type = 'GARBAGE';
            for (const piece of state.lockedPieces) {
                if (piece.y === state.boardGrid.length - 1) piece.type = 'GARBAGE';
            }
            const bot = new GravityBotController({
                playerState: state,
                difficulty: 10,
                actions: {},
                rng: () => 0.5,
                // Stop before the beam independently expands the next piece.
                planUnitsPerMs: 0.075,
            });
            const { candidate } = bot.plan();
            expect(candidate).toMatchObject({
                shapeKey: 'I', x: 0, rotation: 0, waves: [],
            });
            expect(candidate.futurePlan?.candidate).toMatchObject({
                shapeKey: first, x: 8, rotation, waves: [1, 1],
            });
        } finally {
            state.reset();
        }
    });
});
