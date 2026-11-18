// Compare the shape of a stack with the gravity clears it releases on the same deal.
import {
    GameState, spawnPiece, move, rotate, softDrop, hardDrop, fillBag,
} from '../src/core/game.js';
import { measureBoard } from '../src/core/ai/board-evaluator.js';
import { PuzzleBotController } from '../src/core/ai/puzzle-bot-controller.js';
import { GravityBotController } from '../src/core/ai/gravity-bot-controller.js';
import { bindLegacySessionRng } from '../src/core/session-rng.js';
import { seededRandom } from '../src/utils/helpers.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--legacy');
const PIECES = Number.parseInt(args[0] || '180', 10);
const DIFFICULTY = Number.parseInt(args[1] || '10', 10);
const SEEDS = (args[2] || '42,7,1337,2024,55').split(',').map(Number);

const Controller = process.argv.includes('--legacy') ? PuzzleBotController : GravityBotController;

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

async function runGame(seed) {
    const gs = new GameState({ disableLevelProgression: true, hitStopEnabled: false, lockBonusPolicy: 'legacy-max' });
    gs.isSeeking = true;
    bindLegacySessionRng(gs, seed);
    fillBag(gs.nextPieces, gs.randomGenerator);

    let waves = 0, maxWaves = 0, laterLines = 0, lines = 0;
    const physicsCb = {
        spawnPiece: () => spawnPiece(gs, null, () => { gs.isGameOver = true; }),
        onLineClear: (count) => { if (waves++) laterLines += count; lines += count; },
    };
    const perform = (a) => {
        if (a.type === 'move') return a.dir < 0 ? move(gs, -1) : move(gs, 1);
        if (a.type === 'rotate') return rotate(gs, a.dir);
        if (a.type === 'softDrop') return softDrop(gs, null, physicsCb);
        if (a.type === 'hardDrop') return hardDrop(gs, null, physicsCb);
        return false;
    };
    const bot = new Controller({
        actions: {}, difficulty: DIFFICULTY, playerIndex: 0, playerState: gs,
        rng: seededRandom((seed ^ 0x85ebca6b) >>> 0),
    });
    spawnPiece(gs, null, () => { gs.isGameOver = true; });

    const samples = { holes: [], bumpiness: [], maxHeight: [], aggregate: [] };
    let holeIncreaseTurns = 0;
    let prevHoles = 0;

    for (let i = 0; i < PIECES && gs.currentPiece && !gs.isGameOver; i++) {
        const plan = bot.plan();
        if (!plan) break;
        waves = 0;
        const before = gs.piecesPlaced;
        for (const a of plan.actions) if (!perform(a)) throw Error('Rejected input ' + JSON.stringify(a));
        if (gs.latestPhysicsPromise) await gs.latestPhysicsPromise;
        if (!gs.isGameOver && gs.piecesPlaced !== before + 1) throw Error('Expected one lock per plan');
        maxWaves = Math.max(maxWaves, waves);

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
        maxWaves, laterLines, lines, toppedOut: gs.isGameOver,
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
    console.table(rows.map(({ seed, maxWaves, laterLines, lines, toppedOut }) =>
        ({ seed, maxWaves, laterLines, lines, toppedOut })));
    console.log('\nMEANS: avgHoles=' + agg('avgHoles') + ' avgBumpiness=' + agg('avgBumpiness') +
        ' avgMaxHeight=' + agg('avgMaxHeight') + ' avgAggregate=' + agg('avgAggregate'));
}

main().catch((e) => { console.error(e); process.exit(1); });
