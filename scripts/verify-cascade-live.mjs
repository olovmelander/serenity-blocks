// Replay a controller's legal inputs through live physics, skipping animation waits.
// node scripts/verify-cascade-live.mjs [pieces] [difficulty] [seed] [--legacy]
import { COLS, HIDDEN_ROWS } from '../src/core/constants.js';
import {
    GameState, spawnPiece, move, rotate, softDrop, hardDrop, fillBag,
} from '../src/core/game.js';
import { PuzzleBotController } from '../src/core/ai/puzzle-bot-controller.js';
import { GravityBotController } from '../src/core/ai/gravity-bot-controller.js';
import { calculateGarbage } from '../src/core/garbage.js';
import { bindLegacySessionRng } from '../src/core/session-rng.js';
import { seededRandom } from '../src/utils/helpers.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--legacy');
const PIECES = Number.parseInt(process.env.PIECES || args[0] || '160', 10);
const DIFFICULTY = Number.parseInt(process.env.DIFFICULTY || args[1] || '10', 10);
const SEED = Number.parseInt(process.env.SEED || args[2] || '1337', 10);
const QUIET = process.env.QUIET === '1';
const legacy = process.argv.includes('--legacy');

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
    const gs = new GameState({ disableLevelProgression: true, hitStopEnabled: false, lockBonusPolicy: 'legacy-max' });
    gs.isSeeking = true; // real cascade logic, no animation/RAF waits
    bindLegacySessionRng(gs, SEED);
    fillBag(gs.nextPieces, gs.randomGenerator);

    let lastSummary = null;
    let waveLines = [];
    let perfectClears = 0;
    const physicsCb = {
        spawnPiece: () => spawnPiece(gs, null, () => { gs.isGameOver = true; }),
        onGarbageReady: (s) => { lastSummary = s; },
        onPerfectClear: () => { perfectClears += 1; },
        onLineClear: (lines) => waveLines.push(lines),
    };

    const actions = {
        moveLeft: () => move(gs, -1),
        moveRight: () => move(gs, 1),
        rotateLeft: () => rotate(gs, 'left'),
        rotateRight: () => rotate(gs, 'right'),
        rotateFlip: () => rotate(gs, 'flip'),
        softDrop: () => softDrop(gs, null, physicsCb),
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

    const Controller = legacy ? PuzzleBotController : GravityBotController;
    const bot = new Controller({
        actions, difficulty: DIFFICULTY, playerIndex: 0, playerState: gs, rng: seededRandom((SEED ^ 0x85ebca6b) >>> 0),
    });

    // First piece.
    spawnPiece(gs, null, () => { gs.isGameOver = true; });

    const stats = {
        pieces: 0, totalLines: 0, clears: 0, cascades: 0, quadPlus: 0,
        maxDepth: 0, maxComplexity: 0, perfectClears: 0, attackSent: 0,
        bySize: {}, byWaves: {}, laterLines: 0, fires: [],
    };
    let bestMachine = null; // { preBoard, depth, complexity, clean, atPiece }

    for (let i = 0; i < PIECES && gs.currentPiece && !gs.isGameOver; i++) {
        const preBoard = snapshotBoard(gs);
        const top = gs.boardGrid.findIndex((row, y) => y >= HIDDEN_ROWS && row.some(Boolean));
        const preHeight = top < 0 ? 0 : gs.boardGrid.length - top;
        lastSummary = null;
        waveLines = [];

        const plan = bot.plan();
        if (!plan) break;
        const before = gs.piecesPlaced;
        for (const a of plan.actions) if (!perform(a)) throw Error('Rejected input ' + JSON.stringify(a));
        if (gs.latestPhysicsPromise) await gs.latestPhysicsPromise;
        if (!gs.isGameOver && gs.piecesPlaced !== before + 1) throw Error('Expected one lock per plan');

        stats.pieces += 1;
        if (lastSummary && lastSummary.depth > 0) {
            const depth = lastSummary.depth;
            if (depth === 1) {
                stats.singleHeights = stats.singleHeights || [];
                stats.singleHeights.push(preHeight);
            }
            const complexity = waveLines.length;
            const clean = !!lastSummary.sendForPerfectClear;
            stats.clears += 1;
            stats.totalLines += depth;
            stats.bySize[depth] = (stats.bySize[depth] || 0) + 1;
            stats.byWaves[complexity] = (stats.byWaves[complexity] || 0) + 1;
            stats.laterLines += waveLines.slice(1).reduce((sum, n) => sum + n, 0);
            if (complexity >= 2) stats.cascades += 1;
            if (depth >= 4) stats.quadPlus += 1;
            stats.maxDepth = Math.max(stats.maxDepth, depth);
            stats.maxComplexity = Math.max(stats.maxComplexity, complexity);
            stats.attackSent += calculateGarbage(lastSummary).getTotalLines();
            if (depth >= 3 || complexity >= 2) {
                stats.fires.push({ piece: i + 1, depth, complexity, waves: waveLines, clean });
            }
            if (complexity > (bestMachine?.complexity || 0)
                || (complexity === bestMachine?.complexity && depth > bestMachine.depth)) {
                bestMachine = { preBoard, depth, complexity, clean, atPiece: i + 1 };
            }
            if (complexity >= 4 && !stats.firstBigFire) {
                stats.firstBigFire = {
                    piece: i + 1, depth, complexity, clean, preHeight, preBoard,
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
        policy: legacy ? 'legacy' : 'gravity', seed: SEED, pieces: stats.pieces, score: gs.score,
        toppedOut: gs.isGameOver, totalLines: stats.totalLines,
        linesPerPiece: +(stats.totalLines / Math.max(1, stats.pieces)).toFixed(3),
        clears: stats.clears, cascades: stats.cascades, quadPlus: stats.quadPlus,
        big5: stats.fires.filter((f) => f.depth >= 5).length,
        maxDepth: stats.maxDepth, maxComplexity: stats.maxComplexity,
        maxWaves: stats.maxComplexity, waveSpread: stats.byWaves, laterLines: stats.laterLines,
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
        console.log(`\n--- First four-wave fire on piece #${f.piece}, ${f.depth} lines, ` +
            `complexity ${f.complexity}, board height ${f.preHeight}/20 ` +
            `(${f.preHeight <= 10 ? 'CLEAN early build' : 'tall board'}) ---`);
        console.log(f.preBoard.join('\n'));
    } else {
        console.log('\nNo four-wave fire in this run.');
    }
    console.log('\nfires (depth>=3 or cascade):', JSON.stringify(stats.fires));
    console.log(gs.isGameOver ? `\n[topped out after ${stats.pieces} pieces]` : `\n[survived all ${stats.pieces} pieces]`);
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
