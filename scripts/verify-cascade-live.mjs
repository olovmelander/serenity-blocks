// Headless LIVE verification of the cascade-machine bot.
// Drives the EXACT real match code path — real spawnPiece -> real move/rotate/
// hardDrop -> real lockPiece -> real processPhysics cascade (run in seek mode so
// the animation waits are skipped) — and observes whether the bot builds and
// FIRES side-lane cascade machines through the real physics (not the bot's own
// simulator). Run with: node scripts/verify-cascade-live.mjs [pieces] [difficulty]
import { COLS, HIDDEN_ROWS } from '../src/core/constants.js';
import {
    GameState, spawnPiece, move, rotate, softDrop, hardDrop, fillBag,
} from '../src/core/game.js';
import { PuzzleBotController } from '../src/core/ai/puzzle-bot-controller.js';

const PIECES = Number.parseInt(process.env.PIECES || process.argv[2] || '160', 10);
const DIFFICULTY = Number.parseInt(process.env.DIFFICULTY || process.argv[3] || '10', 10);
const SEED = Number.parseInt(process.env.SEED || process.argv[4] || '1337', 10);
// Experimental "hold to build bigger when safe" knob (0 = current shipped behaviour).
const HOLD_TARGET = Number.parseInt(process.env.HOLD_TARGET || '0', 10);
const SAFE_ROWS = Number.parseInt(process.env.SAFE_ROWS || '8', 10);
const QUIET = process.env.QUIET === '1';

function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function snapshotBoard(gs) {
    const grid = gs.boardGrid;
    const rows = [];
    let firstFilled = grid.length;
    for (let y = HIDDEN_ROWS; y < grid.length; y++) {
        if (grid[y].some((c) => c)) { firstFilled = y; break; }
    }
    for (let y = Math.max(HIDDEN_ROWS, firstFilled - 1); y < grid.length; y++) {
        let line = '';
        for (let x = 0; x < COLS; x++) line += grid[y][x] ? '#' : '.';
        rows.push(line);
    }
    return rows;
}

async function main() {
    const rng = mulberry32(SEED);
    const gs = new GameState();
    gs.isSeeking = true; // real cascade logic, no animation/RAF waits
    gs.randomGenerator = rng;
    fillBag(gs.nextPieces, rng);

    let lastSummary = null;
    let perfectClears = 0;
    const physicsCb = {
        spawnPiece: () => spawnPiece(gs, null, () => { gs.isGameOver = true; }),
        onGarbageReady: (s) => { lastSummary = s; },
        onPerfectClear: () => { perfectClears += 1; },
        onPieceLock: () => {},
    };

    const actions = {
        moveLeft: () => move(gs, -1),
        moveRight: () => move(gs, 1),
        rotateLeft: () => rotate(gs, 'left'),
        rotateRight: () => rotate(gs, 'right'),
        rotateFlip: () => rotate(gs, 'flip'),
        softDrop: () => softDrop(gs, null, null),
        hardDrop: () => hardDrop(gs, null, physicsCb),
    };
    const perform = (a) => {
        switch (a.type) {
        case 'move': return a.dir < 0 ? actions.moveLeft() : actions.moveRight();
        case 'rotate':
            if (a.dir === 'left') return actions.rotateLeft();
            if (a.dir === 'flip') return actions.rotateFlip();
            return actions.rotateRight();
        case 'softDrop': return actions.softDrop();
        case 'hardDrop': return actions.hardDrop();
        default: return false;
        }
    };

    const bot = new PuzzleBotController({
        actions, difficulty: DIFFICULTY, playerIndex: 0, playerState: gs, rng,
    });

    // First piece.
    spawnPiece(gs, null, () => { gs.isGameOver = true; });

    const stats = {
        pieces: 0, totalLines: 0, clears: 0, cascades: 0, tetrisPlus: 0,
        maxDepth: 0, maxComplexity: 0, perfectClears: 0, attackSent: 0,
        bySize: {}, fires: [],
    };
    let bestMachine = null; // { preBoard, depth, complexity, clean, atPiece }

    for (let i = 0; i < PIECES && gs.currentPiece && !gs.isGameOver; i++) {
        const preBoard = snapshotBoard(gs);
        lastSummary = null;

        const plan = bot.plan();
        if (!plan) break;
        for (const a of plan.actions) perform(a);
        if (gs.currentPiece && !gs.isProcessingPhysics) hardDrop(gs, null, physicsCb);
        if (gs.latestPhysicsPromise) await gs.latestPhysicsPromise;

        // Stack height of the board the piece landed on (pre-fire), for diagnosis.
        let preHeight = 0;
        for (let y = HIDDEN_ROWS; y < gs.boardGrid.length; y++) {
            if (gs.boardGrid[y]?.some((c) => c)) { preHeight = gs.boardGrid.length - y; break; }
        }

        stats.pieces += 1;
        if (lastSummary && lastSummary.depth > 0) {
            const depth = lastSummary.depth;
            if (depth === 1) {
                stats.singleHeights = stats.singleHeights || [];
                stats.singleHeights.push(preHeight);
            }
            const complexity = lastSummary.complexity || 1;
            const clean = !!lastSummary.sendForClean;
            stats.clears += 1;
            stats.totalLines += depth;
            stats.bySize[depth] = (stats.bySize[depth] || 0) + 1;
            if (complexity >= 2) stats.cascades += 1;
            if (depth >= 4) stats.tetrisPlus += 1;
            stats.maxDepth = Math.max(stats.maxDepth, depth);
            stats.maxComplexity = Math.max(stats.maxComplexity, complexity);
            stats.attackSent += Math.max(0, depth - 1) + (clean ? Math.floor((1 + depth) / 2) : 0);
            if (depth >= 3 || complexity >= 2) {
                stats.fires.push({ piece: i, depth, complexity, clean });
            }
            if (depth > (bestMachine?.depth || 0)) {
                bestMachine = { preBoard, depth, complexity, clean, atPiece: i };
            }
            // First deliberate "big cascade" (>=4 lines) and whether it happened on
            // a clean early build (low board) vs a forced/messy late one.
            if (depth >= 4 && !stats.firstBigFire) {
                stats.firstBigFire = {
                    piece: i, depth, complexity, clean, preHeight, preBoard,
                };
            }
        }
    }
    stats.perfectClears = perfectClears;

    // Compact, parseable summary for sweep aggregation.
    const cascadeDepths = stats.fires.filter((f) => f.complexity >= 2).map((f) => f.depth);
    const avgCascadeDepth = cascadeDepths.length
        ? (cascadeDepths.reduce((a, b) => a + b, 0) / cascadeDepths.length) : 0;
    const summary = {
        hold: HOLD_TARGET, safeRows: SAFE_ROWS, seed: SEED, pieces: stats.pieces,
        toppedOut: gs.isGameOver, totalLines: stats.totalLines,
        linesPerPiece: +(stats.totalLines / Math.max(1, stats.pieces)).toFixed(3),
        clears: stats.clears, cascades: stats.cascades, tetrisPlus: stats.tetrisPlus,
        big5: stats.fires.filter((f) => f.depth >= 5).length,
        maxDepth: stats.maxDepth, maxComplexity: stats.maxComplexity,
        avgCascadeDepth: +avgCascadeDepth.toFixed(2), attackSent: stats.attackSent,
        perfectClears, singles: (stats.singleHeights || []).length,
    };
    console.log('SUMMARY ' + JSON.stringify(summary));
    if (QUIET) return;

    console.log('\n===== LIVE CASCADE-BOT VERIFICATION =====');
    console.log(`difficulty=${DIFFICULTY} seed=${SEED} pieces requested=${PIECES}`);
    console.log(JSON.stringify(stats, null, 2));
    if (bestMachine) {
        console.log(`\n--- Biggest cascade: ${bestMachine.depth} lines, complexity ${bestMachine.complexity}` +
            `${bestMachine.clean ? ', PERFECT CLEAR' : ''} (piece #${bestMachine.atPiece}) ---`);
        console.log('Board the piece BEFORE the fire (the loaded machine):');
        console.log(bestMachine.preBoard.join('\n'));
    }
    if (stats.firstBigFire) {
        const f = stats.firstBigFire;
        console.log(`\n--- FIRST big cascade (>=4 lines): piece #${f.piece}, ${f.depth} lines, ` +
            `complexity ${f.complexity}, board height ${f.preHeight}/20 ` +
            `(${f.preHeight <= 10 ? 'CLEAN early build' : 'tall board'}) ---`);
        console.log(f.preBoard.join('\n'));
    } else {
        console.log('\n--- NO big cascade (>=4) fired this run ---');
    }
    console.log('\nfires (depth>=3 or cascade):', JSON.stringify(stats.fires));
    console.log(gs.isGameOver ? `\n[topped out after ${stats.pieces} pieces]` : `\n[survived all ${stats.pieces} pieces]`);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
