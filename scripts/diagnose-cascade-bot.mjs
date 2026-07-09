// Empirical diagnosis: run the real engine and track board QUALITY per piece
// (holes, bumpiness, height) to find why the bot's stacking gets messy.
import { COLS, HIDDEN_ROWS } from '../src/core/constants.js';
import {
    GameState, spawnPiece, move, rotate, softDrop, hardDrop, fillBag,
} from '../src/core/game.js';
import { measureBoard } from '../src/core/ai/board-evaluator.js';
import { PuzzleBotController } from '../src/core/ai/puzzle-bot-controller.js';

const PIECES = Number.parseInt(process.argv[2] || '180', 10);
const DIFFICULTY = Number.parseInt(process.argv[3] || '10', 10);
const SEEDS = (process.argv[4] || '42,7,1337,2024,55').split(',').map(Number);

function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

async function runGame(seed) {
    const rng = mulberry32(seed);
    const gs = new GameState();
    gs.isSeeking = true;
    gs.randomGenerator = rng;
    fillBag(gs.nextPieces, rng);

    const physicsCb = {
        spawnPiece: () => spawnPiece(gs, null, () => { gs.isGameOver = true; }),
        onGarbageReady: () => {}, onPerfectClear: () => {}, onPieceLock: () => {},
    };
    const perform = (a) => {
        if (a.type === 'move') return a.dir < 0 ? move(gs, -1) : move(gs, 1);
        if (a.type === 'rotate') return rotate(gs, a.dir);
        if (a.type === 'softDrop') return softDrop(gs, null, null);
        if (a.type === 'hardDrop') return hardDrop(gs, null, physicsCb);
        return false;
    };
    const bot = new PuzzleBotController({
        actions: {}, difficulty: DIFFICULTY, playerIndex: 0, playerState: gs, rng,
    });
    spawnPiece(gs, null, () => { gs.isGameOver = true; });

    const samples = { holes: [], bumpiness: [], maxHeight: [], aggregate: [] };
    let holeIncreaseTurns = 0;
    let prevHoles = 0;

    for (let i = 0; i < PIECES && gs.currentPiece && !gs.isGameOver; i++) {
        const plan = bot.plan();
        if (!plan) break;
        for (const a of plan.actions) perform(a);
        if (gs.currentPiece && !gs.isProcessingPhysics) hardDrop(gs, null, physicsCb);
        if (gs.latestPhysicsPromise) await gs.latestPhysicsPromise;

        const m = measureBoard(gs.boardGrid);
        samples.holes.push(m.holes);
        samples.bumpiness.push(m.bumpiness);
        samples.maxHeight.push(m.maxHeight);
        samples.aggregate.push(m.aggregateHeight);
        if (m.holes > prevHoles) holeIncreaseTurns += 1;
        prevHoles = m.holes;
    }

    return {
        seed,
        avgHoles: +mean(samples.holes).toFixed(2),
        maxHoles: Math.max(0, ...samples.holes),
        avgBumpiness: +mean(samples.bumpiness).toFixed(2),
        avgMaxHeight: +mean(samples.maxHeight).toFixed(2),
        avgAggregate: +mean(samples.aggregate).toFixed(1),
        holeMakingTurns: holeIncreaseTurns,
        pieces: samples.holes.length,
    };
}

async function main() {
    console.log(`Diagnosing tier ${DIFFICULTY}, ${PIECES} pieces, seeds ${SEEDS.join(',')}\n`);
    const rows = [];
    for (const s of SEEDS) rows.push(await runGame(s));
    console.log('seed   | avgHoles | maxHoles | avgBumpiness | avgMaxH | avgAggH | hole-making turns');
    console.log('-------|----------|----------|--------------|---------|---------|------------------');
    for (const r of rows) {
        console.log(`${String(r.seed).padEnd(6)} |   ${String(r.avgHoles).padStart(5)}  |    ${String(r.maxHoles).padStart(3)}   |     ${String(r.avgBumpiness).padStart(5)}    |  ${String(r.avgMaxHeight).padStart(5)}  |  ${String(r.avgAggregate).padStart(5)} |   ${r.holeMakingTurns}/${r.pieces}`);
    }
    const agg = (k) => +mean(rows.map((r) => r[k])).toFixed(2);
    console.log('\nMEANS: avgHoles=' + agg('avgHoles') + ' avgBumpiness=' + agg('avgBumpiness') +
        ' avgMaxHeight=' + agg('avgMaxHeight') + ' avgAggregate=' + agg('avgAggregate'));
}

main().catch((e) => { console.error(e); process.exit(1); });
