// Isolate the immediate ranking effect on a known successful route. Only the
// diagnostic copy of the score changes. The fixture follows the original witness.
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { BOARD_SHAPE_WEIGHTS as shape, CASCADE_ADAPTATION_WEIGHTS as w, rankCandidates } from '../../src/core/ai/board-evaluator.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { calculateGarbage } from '../../src/core/garbage.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { deal, spawn, replay } from './solo.mjs';

function charges(c) {
    const m = c.evaluation.metrics;
    const p = m.preparationAfter;
    const exposed = (metric, protectedAmount = 0) => Math.max(0, metric - protectedAmount);
    const hole = w.coveredHole * exposed(m.holes, p.protectedLaneHoleCells)
        + w.cavityCells * exposed(m.cavityCells, p.protectedLaneHoleCells)
        + w.holeDepth * exposed(m.holeDepth, p.protectedLaneHoleDepth)
        + w.maxHoleDepth * m.maxHoleDepth + w.rowsWithHoles * exposed(m.rowsWithHoles, p.protectedLaneRows)
        + w.weightedHoles * exposed(m.weightedHoles, p.protectedLaneWeightedHoles);
    const surface = shape.wellSums * exposed(m.wellSums, p.protectedLaneWellSums) * 0.65
        + shape.landingHeight * m.landingHeight * (1 + m.pressureRatio * 0.75)
        + 0.85 * (shape.columnTransitions * m.columnTransitions + shape.rowTransitions * m.rowTransitions + w.bumpiness * m.bumpiness)
        + w.deepWells * m.deepWells + w.heightSpread * m.heightSpread + w.aggregateHeight * m.aggregateHeight + w.maxHeight * m.maxHeight;
    return { hole, surface };
}

writeFileSync(process.argv[2], '', { flag: 'wx' });
for (const file of process.argv.slice(3)) {
    const records = readFileSync(file, 'utf8').trim().split('\n').map(x => JSON.parse(x));
    for (const g of records) {
        const state = deal(g.seed);
        const bot = new PuzzleBotController({ difficulty: 10, playerState: state, playerIndex: 0, actions: {}, rng: () => 0.5 });
        const rows = [];
        let attack = 0;
        for (const t of g.trace) {
            const ranked = rankCandidates(bot.evaluatePlacements(state, findReachablePlacements(state)), bot.config, bot.rng);
            const c = ranked.find(p => p.shapeKey === t.key && p.x === t.x && p.y === t.y && p.rotation === t.r);
            if (!c || ranked.indexOf(c) + 1 !== t.rank) throw Error('Witness ranking mismatch');
            const charge = new Map(ranked.map(p => [p, charges(p)]));
            const rankAfter = terms => 1 + [...ranked].sort((a,b) => {
                const adjusted = p => terms.reduce((score, term) => score - charge.get(p)[term], p.evaluation.score);
                return adjusted(b) - adjusted(a);
            }).indexOf(c);
            const waveLines = [];
            await replay(state, [...c.actions, { type: 'hardDrop' }], {
                spawnPiece: () => spawn(state), onLineClear: n => waveLines.push(n),
                onGarbageReady: summary => { attack += calculateGarbage(summary).getTotalLines(); },
            });
            if (JSON.stringify(waveLines) !== JSON.stringify(t.waves)) throw Error('Independent replay failed');
            rows.push({ rank: t.rank, minusHole: rankAfter(['hole']), minusSurface: rankAfter(['surface']),
                minusBoth: rankAfter(['hole', 'surface']), waves: t.waves.length });
        }
        appendFileSync(process.argv[2], JSON.stringify({ seed: g.seed, mode: g.mode, rows, score: state.score,
            lines: state.lines, attack, topOut: state.isGameOver }) + '\n');
        state.reset();
    }
}
