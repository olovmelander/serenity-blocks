// How often a bot puts a piece exactly where a recorded player put it. Each recorded placement is
// a position: the board before it, the piece, the next three, the rows waiting, the cells chosen.
// The positions come from recordings kept outside this repo: set VERSUS_POSITIONS to the file.
// node agree.mjs <name pattern, e.g. stephen> [tier] [limit] ['{"versusWeights":{...}}' | old | -] [game pattern]
import { readFileSync } from 'node:fs';
import { COLS, HIDDEN_ROWS, SHAPES } from '../../src/core/constants.js';
import { GameState, rotateShapeMatrix } from '../../src/core/game.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';
import { VERSUS_WEIGHTS } from '../../src/core/ai/versus-evaluation.js';
import { applyVersusFeel } from '../../src/core/multiplayer/versus-rules.js';

console.debug = () => {};
const FILE = process.env.VERSUS_POSITIONS;
let loaded = null;
export function positions() {
    if (!FILE) throw Error('Set VERSUS_POSITIONS to the file of recorded positions (see docs/BOT_VERSUS_HANDOVER_2026-11.md)');
    loaded ??= JSON.parse(readFileSync(FILE, 'utf8'));
    return loaded;
}

const TYPE = { G: 'GARBAGE' };
/** The board of a position as the locked bodies our game would hold. */
function bodies(position) {
    const cells = position.cells.split(',').map(Number);
    const boxes = new Map();
    cells.forEach((id, i) => {
        if (!id) return;
        const y = Math.floor(i / COLS); const x = i % COLS;
        const b = boxes.get(id) ?? { top: y, left: x, right: x, bottom: y, cells: [] };
        b.top = Math.min(b.top, y); b.bottom = Math.max(b.bottom, y); b.left = Math.min(b.left, x); b.right = Math.max(b.right, x);
        b.cells.push([y, x]);
        boxes.set(id, b);
    });
    return [...boxes].map(([id, b]) => {
        const shape = Array.from({ length: b.bottom - b.top + 1 }, () => Array(b.right - b.left + 1).fill(0));
        b.cells.forEach(([y, x]) => { shape[y - b.top][x - b.left] = 1; });
        const kind = position.kinds[id - 1];
        const type = TYPE[kind] ?? kind;
        return { pieceId: `p${id}`, shapeKey: type, type, color: type, x: b.left, y: b.top, shape, isGarbage: kind === 'G' };
    });
}

function cellsOf(key, candidate) {
    let shape = SHAPES[key];
    for (let i = 0; i < (candidate.rotation ?? 0); i++) shape = rotateShapeMatrix(shape, 'right');
    return shape.flatMap((row, dy) => row.flatMap((v, dx) => (v ? [(candidate.y + dy) * COLS + candidate.x + dx] : []))).sort((a, b) => a - b);
}

/**
 * Play a list of positions with a bot and count where it agrees with the player.
 * @returns {{ n: number, same: number, sameColumns: number, clears: number, clearsSame: number }}
 */
export function agreement(list, { tier = 10, versusWeights = VERSUS_WEIGHTS, each = null } = {}) {
    const state = new GameState({ disableLevelProgression: true, hitStopEnabled: false });
    applyVersusFeel(state);
    state.isSeeking = true;
    let waiting = 0;
    const bot = new GravityBotController({
        playerState: state, playerIndex: 0, difficulty: tier, actions: {}, rng: () => 0.99, versus: true, versusWeights, pendingRows: () => waiting,
    });
    bot.config.mistakeChance = 0;
    const out = { n: 0, same: 0, sameColumns: 0, clears: 0, clearsSame: 0, fired: 0 };
    for (const position of list) {
        state.lockedPieces = bodies(position);
        rebuildBoardGridFromPieces(state.lockedPieces, state.boardGrid);
        state.boardCacheDirty = true;
        const shape = SHAPES[position.piece].map((row) => row.slice());
        state.currentPiece = { shapeKey: position.piece, type: position.piece, color: position.piece, shape, rotation: 0,
            x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: HIDDEN_ROWS - 2 };
        state.nextPieces = position.next.slice();
        state.piecesPlaced += 1;
        state.lines = 8;
        waiting = position.pending;
        bot.reset();
        // Where in its life the position stands (the opening, versusOpening).
        bot.life = { done: position.fired ?? true, pieces: (position.at ?? 99) - 1 };
        let plan = null;
        try { plan = bot.plan(); } catch { plan = null; }
        if (!plan?.candidate) continue;
        const mine = cellsOf(position.piece, plan.candidate);
        const same = mine.length === position.chose.length && mine.every((v, i) => v === position.chose[i]);
        const columns = (cs) => [...new Set(cs.map((v) => v % COLS))].sort().join();
        out.n++;
        each?.(position, mine, plan.candidate, same);
        out.same += Number(same);
        out.sameColumns += Number(columns(mine) === columns(position.chose));
        out.fired += Number((plan.candidate.totalLines ?? 0) >= 2);
        if (position.lines >= 2) { out.clears++; out.clearsSame += Number(same); }
    }
    return out;
}

/** Every `step`th position of the players whose name matches, from games that match. */
export function pick({ name = /./, game = /./, players = null, step = 1, offset = 0 } = {}) {
    return positions().filter((p) => name.test(p.name) && game.test(p.game) && (players === null || players(p.players)))
        .filter((_, i) => i % step === offset % step);
}

if (process.argv[1]?.endsWith('agree.mjs')) {
    const [who = 'stephen', tier = '10', limit = '1500', how = '', games = '.'] = process.argv.slice(2);
    const options = { tier: Number(tier) };
    if (how === 'old') options.versusWeights = null;
    else if (how && how !== '-') options.versusWeights = JSON.parse(how).versusWeights;
    const all = pick({ name: new RegExp(who, 'i'), game: new RegExp(games) });
    const step = Math.max(1, Math.floor(all.length / Number(limit)));
    const list = all.filter((_, i) => i % step === 0);
    const t0 = Date.now();
    const r = agreement(list, options);
    const pct = (a, b) => `${(100 * a / Math.max(1, b)).toFixed(1)}%`;
    console.info(`${who} in ${games}, tier ${tier}${how === 'old' ? ' (old play)' : ''}: ${r.n} positions, same cells ${pct(r.same, r.n)}, same columns ${pct(r.sameColumns, r.n)}, on his fires ${pct(r.clearsSame, r.clears)} of ${r.clears}; bot fires on ${pct(r.fired, r.n)}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    process.exit(0);
}
