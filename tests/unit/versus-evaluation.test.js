/**
 * Versus play (versus-evaluation.js): what a board and a clear are worth to a versus bot, what its
 * match tells it, and where it applies: local versus in the standard well and in Last Standing.
 * Odyssey rivals keep their own play.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import {
    COLS, HIDDEN_ROWS, ROWS, SHAPES,
} from '../../src/core/constants.js';
import {
    fillBag, GameState, rotateShapeMatrix, spawnPiece,
} from '../../src/core/game.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { GravityBotController, gravityPlanningRate } from '../../src/core/ai/gravity-bot-controller.js';
import { readGravityBoard, steadyLandings } from '../../src/core/ai/gravity-search.js';
import { LocalBotManager } from '../../src/core/ai/local-bot-manager.js';
import {
    VERSUS_WEIGHTS, rowsToBlockSpawn, rowsToRoof, versusAttack, versusCalm, versusReward, versusTrigger, versusValue,
} from '../../src/core/ai/versus-evaluation.js';

const HEIGHT = ROWS + HIDDEN_ROWS;
const PLAY = { weights: VERSUS_WEIGHTS };

/** A board from its lowest rows, top row first: letters are bodies, '.' is empty, '=' is garbage. */
function grid(lines) {
    const rows = Array.from({ length: HEIGHT }, () => Array(COLS).fill(null));
    lines.forEach((line, i) => [...line].forEach((ch, x) => {
        if (ch === '.') return;
        rows[HEIGHT - lines.length + i][x] = { id: ch === '=' ? `g${i}` : ch, type: ch === '=' ? 'GARBAGE' : 'O', color: ch };
    }));
    return rows;
}

const worth = (lines, pending = 0) => {
    const board = readGravityBoard(grid(lines));
    return versusValue(board, PLAY, pending, new Int32Array(board.cells.length));
};

describe('rows a clear sends', () => {
    it('are its lines minus one, whatever the waves, from the smallest attacking clear up', () => {
        expect([0, 1, 2, 3, 7].map((n) => versusAttack(n, false))).toEqual([0, 0, 1, 2, 6]);
        expect([2, 3, 4, 5].map((n) => versusAttack(n, false, 4))).toEqual([0, 0, 3, 4]);
    });

    it('gain the clean bonus even below the smallest attacking clear', () => {
        expect(versusAttack(3, true)).toBe(4);
        expect(versusAttack(2, true, 4)).toBe(1);
    });

    it('earn more the bigger the clear, and nothing while attacks deal nothing', () => {
        const each = [2, 4, 8].map((n) => versusReward(PLAY, n, false) / (n - 1));
        expect(each[1]).toBeGreaterThan(each[0]);
        expect(each[2]).toBeGreaterThan(each[1]);
        expect(versusReward({ ...PLAY, worth: 0 }, 8, false)).toBe(0);
        expect(versusReward({ ...PLAY, worth: 0 }, 1, false, 1)).toBe(0);
        expect(versusReward(PLAY, 0, false)).toBe(0);
    });

    it('a holder of the hot potato counts rows, not size', () => {
        const flat = { ...PLAY, flat: true };
        expect(versusReward(flat, 9, false) / 8).toBeCloseTo(versusReward(flat, 5, false) / 4);
    });

    it('that end somebody earn the kill', () => {
        const kill = { ...PLAY, killRows: 3 };
        expect(versusReward(kill, 4, false) - versusReward(PLAY, 4, false)).toBeCloseTo(VERSUS_WEIGHTS.kill);
        expect(versusReward(kill, 3, false)).toBe(versusReward(PLAY, 3, false));
    });

    it('a small clear waits on a low board and not on a high one or with rows coming', () => {
        const board = (rows) => readGravityBoard(grid(Array.from({ length: rows }, () => '....A.....')));
        expect(versusCalm(board(1), 0, PLAY)).toBeGreaterThan(versusCalm(board(10), 0, PLAY));
        expect(versusCalm(board(19), 0, PLAY)).toBe(0);
        expect(versusCalm(board(1), 1, PLAY)).toBe(0);
        expect(versusReward(PLAY, 2, false, 1)).toBeLessThan(versusReward(PLAY, 2, false, 0));
        expect(versusReward(PLAY, 6, false, 1)).toBe(versusReward(PLAY, 6, false, 0));
    });

    it('a shot another piece could make grows with its rows', () => {
        expect(versusTrigger(PLAY, 1)).toBe(0);
        expect(versusTrigger(PLAY, 6)).toBeGreaterThan(versusTrigger(PLAY, 3));
        expect(versusTrigger({ ...PLAY, minAttackLines: 5 }, 4)).toBe(0);
    });
});

describe('what a board has put by', () => {
    // A roofed left column over four rows one cell short, with and without a straight on the roof.
    const shelf = (tower) => [
        ...(tower ? ['I.........', 'I.........', 'I.........', 'I.........'] : []),
        'AA........',
        '.BCCDDEEFF',
        '.BCCDDEEFF',
        '.GHHKKLLMM',
        '.GHHKKLLMM',
    ];

    it('counts a straight parked over a roofed edge column with rows ready', () => {
        // The same straight lying on the far side of the stack puts nothing by.
        const lying = shelf(false).slice();
        lying[0] = 'AA....IIII';
        expect(worth(shelf(true))).toBeGreaterThan(worth(lying));
    });

    it('is the same on either side', () => {
        const mirror = (lines) => lines.map((line) => [...line].reverse().join(''));
        expect(worth(mirror(shelf(true)))).toBeCloseTo(worth(shelf(true)));
    });

    it('prefers the empty cells in the edge column to the same cells buried in the middle', () => {
        const buried = shelf(true).map((line) => (line.startsWith('.') ? `${line.slice(1, 6)}.${line.slice(6)}` : line));
        expect(worth(shelf(true))).toBeGreaterThan(worth(buried));
    });

    it('counts rows from an opponent like any other', () => {
        const built = ['.BCCDDEEFF', '.BCCDDEEFF', '.GHHKKLLMM', '.GHHKKLLMM'];
        const rows = ['.=========', '.=========', '.=========', '.========='];
        expect(Math.abs(worth(rows) - worth(built))).toBeLessThan(40);
    });

    it('fears the spawn columns and the rows that are waiting, not a tower at the side', () => {
        const tower = Array.from({ length: 18 }, () => 'A.........');
        const centre = Array.from({ length: 18 }, () => '....A.....');
        expect(worth(tower)).toBeGreaterThan(worth(centre));
        expect(worth(centre, 4)).toBeLessThan(worth(centre));
    });
});

describe('rows that keep a next piece from appearing', () => {
    it('are counted from the spawn columns and the rows already waiting', () => {
        const side = grid(Array.from({ length: 20 }, () => 'A.........'));
        expect(rowsToBlockSpawn(side, 0)).toBe(ROWS + 1);
        const centre = grid(Array.from({ length: 15 }, () => '....A.....'));
        expect(rowsToBlockSpawn(centre, 0)).toBe(6);
        expect(rowsToBlockSpawn(centre, 4)).toBe(2);
        expect(rowsToBlockSpawn(centre, 40)).toBe(1);
    });
});

describe('Last Standing', () => {
    // A tower of `rows` in a grid of 44, in a well of `well` rows.
    const tower = (rows) => {
        const lines = Array.from({ length: 44 }, (_, y) => (y >= 44 - rows ? 'AAAA.AAAAA' : '..........'));
        const cells = lines.map((line, y) => [...line].map((ch) => (ch === '.' ? null : { id: `r${y}`, type: 'O' })));
        return readGravityBoard(cells, 0);
    };
    const worth = (rows, well, pending = 0) => {
        const board = tower(rows);
        return versusValue(board, { weights: VERSUS_WEIGHTS, roofRows: well - 44 }, pending, new Int32Array(board.cells.length));
    };

    it('counts the rows to the roof of the well, not to the spawn', () => {
        const grid = Array.from({ length: 44 }, (_, y) => Array.from({ length: COLS }, (__, x) => (y >= 14 && x === 0 ? { id: 'a' } : null)));
        expect(rowsToRoof(grid, 100, 0)).toBe(70);
        expect(rowsToRoof(grid, 100, 12)).toBe(58);
        expect(rowsToRoof(grid, 44, 20)).toBe(1);
    });

    it('fears only the roof: a tall tower costs the same far below it, and more near it', () => {
        const far = worth(30, 100) - worth(20, 100);
        const near = worth(30, 44) - worth(20, 44);
        expect(near).toBeLessThan(far);
        expect(worth(30, 44, 8)).toBeLessThan(worth(30, 44));
        expect(worth(20, 100, 8)).toBeCloseTo(worth(20, 100));
    });

    it('is in no hurry while the roof is far', () => {
        const play = (well) => ({ weights: VERSUS_WEIGHTS, roofRows: well - 44 });
        expect(versusCalm(tower(30), 0, play(100))).toBe(1);
        expect(versusCalm(tower(30), 0, play(50))).toBe(0);
        expect(versusCalm(tower(30), 3, play(100))).toBe(0);
    });

    it('a seat aims its kill at the roof', () => {
        const match = new MultiPlayerState(2);
        match.setMatchConfig({ ...match.matchConfig, isInfinityLMS: true, infinityMaxRows: 60 });
        match.reset();
        const bots = new LocalBotManager({ multiplayerState: match, actionFactory: () => ({}) });
        const grid = match.players[1].boardGrid;
        for (let y = grid.length - 50; y < grid.length; y++) if (y >= 0) grid[y][0] = { id: 'a' };
        expect(bots.versusOutlook(0).killRows).toBe(60 - Math.min(50, grid.length));
    });

    it('plans with the versus search on an Infinity board', () => {
        const match = new MultiPlayerState(2);
        match.setMatchConfig({ ...match.matchConfig, isInfinityLMS: true, infinityMaxRows: 60 });
        match.reset();
        match.sharedPieceSeed = 9;
        const state = match.players[0];
        fillBag(state.nextPieces, state.randomGenerator, state.pieceRandomizer);
        spawnPiece(state, null, () => {});
        const bots = new LocalBotManager({ multiplayerState: match, actionFactory: () => ({}) });
        bots.configure([{ kind: 'bot', difficulty: 10 }, { kind: 'bot', difficulty: 4 }], 1);
        for (const bot of bots.controllers.values()) {
            if (bot.playerState !== state) continue;
            const plan = bot.plan();
            expect(plan.candidate.y).toBeGreaterThan(state.boardGrid.length - 5);
            expect(plan.tactics.protectSpawn).toBe(false);
        }
    });
});

describe('where versus play applies', () => {
    const manager = (match) => {
        const bots = new LocalBotManager({ multiplayerState: match, actionFactory: () => ({}) });
        bots.configure(match.players.map(() => ({ kind: 'bot', difficulty: 10 })), 1);
        return bots;
    };

    it('in the standard well of a local match with attacks on', () => {
        const match = new MultiPlayerState(2);
        match.sharedPieceSeed = 5;
        expect([...manager(match).controllers.values()].every((bot) => bot.versusWeights === VERSUS_WEIGHTS)).toBe(true);
    });

    it('in Last Standing too, with the same hands and reading time', () => {
        const well = new MultiPlayerState(2);
        well.setMatchConfig({ ...well.matchConfig, isInfinityLMS: true, infinityMaxRows: 60 });
        well.reset();
        well.sharedPieceSeed = 5;
        const standard = new MultiPlayerState(2);
        standard.sharedPieceSeed = 5;
        const [a, b] = [manager(well), manager(standard)].map((bots) => bots.controllers.get(0));
        expect(a.playerState.isInfinityMode).toBe(true);
        expect(a.versusWeights).toBe(VERSUS_WEIGHTS);
        expect(a.config.reactionMs).toEqual(b.config.reactionMs);
        expect(a.config.maxApm).toBe(b.config.maxApm);
        expect(a.planUnitsPerMs).toBe(b.planUnitsPerMs);
    });

    it('not in a peaceful match, not for a controller Odyssey builds', () => {
        const peaceful = new MultiPlayerState(2);
        peaceful.setMatchConfig({ ...peaceful.matchConfig, attackRules: { disableAttacks: true } });
        expect([...manager(peaceful).controllers.values()].some((bot) => bot.versusWeights)).toBe(false);
        const rival = new GravityBotController({
            playerState: new GameState(), playerIndex: 0, difficulty: 10, actions: {}, opponentRoom: () => 10,
        });
        expect(rival.versusWeights).toBeNull();
    });

    it('a room of three or four shares what two bots get; a peaceful one keeps the older share', () => {
        expect(gravityPlanningRate(2, 10, true) * 2).toBeCloseTo(2.5);
        expect(gravityPlanningRate(3, 10, true) * 3).toBeCloseTo(2.5);
        expect(gravityPlanningRate(4, 10, true) * 4).toBeCloseTo(2.5);
        expect(gravityPlanningRate(4, 10, false)).toBeCloseTo(0.65 / 4);
        expect(gravityPlanningRate(1, 10, true)).toBe(gravityPlanningRate(1, 10));
    });
});

describe('what the match tells a versus seat', () => {
    const outlook = (configure) => {
        const match = new MultiPlayerState(3);
        match.setMatchConfig({ ...match.matchConfig, ...configure });
        const bots = new LocalBotManager({ multiplayerState: match, actionFactory: () => ({}) });
        return { match, read: () => bots.versusOutlook(0) };
    };

    it('the smallest attacking clear and the nearest kill among the living', () => {
        const { match, read } = outlook({ minAttackLines: 3 });
        match.players[1].boardGrid = grid(Array.from({ length: 12 }, () => '....A.....'));
        match.players[2].boardGrid = grid(Array.from({ length: 17 }, () => '....A.....'));
        expect(read()).toMatchObject({
            minAttackLines: 3, worth: 1, flat: false, killRows: 4,
        });
        match.players[2].isAlive = false;
        expect(read().killRows).toBe(9);
    });

    it('no kill to aim at when attacks send no rows', () => {
        const { match, read } = outlook({ attackRules: { forceAttackType: 'blind' } });
        match.players[1].boardGrid = grid(Array.from({ length: 17 }, () => '....A.....'));
        expect(read().killRows).toBe(Infinity);
    });

    it('who has the hot potato: nothing counts, rows count, or only the holder is attacked', () => {
        const { match, read } = outlook({ hotPotato: true });
        match.hotPotato.holder = null;
        expect(read()).toMatchObject({ worth: 0, killRows: Infinity });
        match.hotPotato.holder = match.potatoTeamOf(0);
        expect(read()).toMatchObject({ worth: 1, flat: true, killRows: Infinity });
        match.hotPotato.holder = match.potatoTeamOf(2);
        match.players[2].boardGrid = grid(Array.from({ length: 17 }, () => '....A.....'));
        expect(read()).toMatchObject({ worth: 1, flat: false, killRows: 4 });
    });
});

describe('a tower at the side', () => {
    // Seen live: a seat kept trying to kick its piece up onto this tower, and it never landed.
    const board = () => [
        '.........#', '.........#', '.........#', '##.......#', '###....#.#', '###....###', '####...###', '.#########',
        '#.########', '#########.', '#########.', '#######...', '.#########', '.#########',
    ].map((line) => line.replaceAll('#', 'A'));
    const seat = () => {
        const state = new GameState();
        let shape = SHAPES.J;
        for (let i = 0; i < 2; i++) shape = rotateShapeMatrix(shape, 'right');
        const rows = grid([...board(), ...Array.from({ length: 10 }, () => 'AAAAAAAAA.')]);
        state.boardGrid.forEach((row, y) => row.forEach((_, x) => { row[x] = rows[y][x]; }));
        state.currentPiece = { shapeKey: 'J', shape, rotation: 2, x: 6, y: 1 };
        state.nextPieces = ['T', 'O', 'I'];
        return new GravityBotController({
            playerState: state, playerIndex: 0, difficulty: 10, actions: {}, rng: () => 0.5, versus: true, versusWeights: VERSUS_WEIGHTS,
        });
    };

    it('is never climbed: nothing above the spawn rows, nothing higher than the piece already is', () => {
        const landing = (y, top = 0) => ({ y, form: { top }, actions: [] });
        const kept = (landings, y) => steadyLandings(landings, { y }, HIDDEN_ROWS, false).map((l) => l.y);
        // Row 2 is the top spawn row; y counts from the piece's box, top is its first filled row.
        expect(kept([landing(-2), landing(1), landing(1, 1), landing(8)], 1)).toEqual([1, 8]);
        expect(kept([landing(4), landing(6), landing(7)], 8)).toEqual([7]);
        // Nowhere else to go: better any landing than none.
        expect(kept([landing(-2)], 1)).toEqual([-2]);
    });

    it('after three refused inputs on a piece, it goes down where it is', () => {
        const bot = seat();
        bot.refusals = { piece: bot.playerState.piecesPlaced, count: 3 };
        const { actions } = bot.plan();
        expect(actions.some(({ type }) => type === 'move' || type === 'rotate')).toBe(false);
    });
});

describe('blind', () => {
    const bot = (rng) => new GravityBotController({
        playerState: new GameState(), playerIndex: 0, difficulty: 10, actions: {}, rng, versusWeights: VERSUS_WEIGHTS,
    });
    const moves = [4, 3, 5].map((x) => ({ x, rotation: 0 }));

    it('slips a piece more often the more of the stack is hidden, and draws nothing in the light', () => {
        const rng = vi.fn(() => 0.1);
        const seer = bot(rng);
        seer.playerState.boardGrid = grid(['ABCDEFGHIJ']);
        expect(seer.chooseGravityMove(moves[0], moves)).toBe(moves[0]);
        expect(rng).not.toHaveBeenCalled();
        seer.playerState.boardGrid.at(-1).forEach((cell) => { cell.blind = 5; });
        expect(seer.chooseGravityMove(moves[0], moves)).not.toBe(moves[0]);
    });

    it('a better player remembers more', () => {
        const slips = (difficulty) => {
            let n = 0;
            for (let i = 0; i < 100; i++) {
                const player = new GravityBotController({
                    playerState: new GameState(), playerIndex: 0, difficulty, actions: {}, rng: () => i / 100, versusWeights: VERSUS_WEIGHTS,
                });
                player.config.mistakeChance = 0;
                player.playerState.boardGrid = grid(['ABCDEFGHIJ']);
                player.playerState.boardGrid.at(-1).forEach((cell) => { cell.blind = 5; });
                if (player.chooseGravityMove(moves[0], moves) !== moves[0]) n++;
            }
            return n;
        };
        expect(slips(10)).toBeLessThan(slips(8));
        expect(slips(8)).toBeLessThan(slips(4));
    });
});
