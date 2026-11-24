/**
 * Versus play (versus-evaluation.js): what a board and a clear are worth to a versus bot, what its
 * match tells it, and where it applies. Odyssey rivals and Last Standing keep their own play.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import { COLS, HIDDEN_ROWS, ROWS } from '../../src/core/constants.js';
import { GameState } from '../../src/core/game.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { GravityBotController, gravityPlanningRate } from '../../src/core/ai/gravity-bot-controller.js';
import { readGravityBoard } from '../../src/core/ai/gravity-search.js';
import { LocalBotManager } from '../../src/core/ai/local-bot-manager.js';
import {
    VERSUS_WEIGHTS, rowsToBlockSpawn, versusAttack, versusCalm, versusReward, versusTrigger, versusValue,
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
        expect(versusReward({ ...PLAY, worth: 0 }, 8, false)).toBeLessThanOrEqual(0);
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

    it('not in Last Standing, not in a peaceful match, not for a controller Odyssey builds', () => {
        const infinity = new MultiPlayerState(2);
        infinity.players.forEach((state) => { state.isInfinityMode = true; });
        expect([...manager(infinity).controllers.values()].some((bot) => bot.versusWeights)).toBe(false);
        const peaceful = new MultiPlayerState(2);
        peaceful.setMatchConfig({ ...peaceful.matchConfig, attackRules: { disableAttacks: true } });
        expect([...manager(peaceful).controllers.values()].some((bot) => bot.versusWeights)).toBe(false);
        const rival = new GravityBotController({
            playerState: new GameState(), playerIndex: 0, difficulty: 10, actions: {}, opponentRoom: () => 10,
        });
        expect(rival.versusWeights).toBeNull();
    });

    it('a room of three or four shares what two bots get; Infinity keeps its share', () => {
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
