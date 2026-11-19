// Compare both controllers through the same controls and physics as the audit.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { canMatchWaves, deal, pose, replay, spawn } from '../bot-ai-audit-2026-11/solo.mjs';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';
import { GRAVITY_WEIGHTS } from '../../src/core/ai/gravity-search.js';
import { calculateGarbage } from '../../src/core/garbage.js';
import { seededRandom } from '../../src/utils/helpers.js';

export async function play(seed, tier, limit, options = {}) {
    const state = deal(seed), decisions = seededRandom((seed ^ 0x85ebca6b) >>> 0);
    const Controller = options.legacy ? PuzzleBotController : GravityBotController;
    const bot = new Controller({ playerState: state, difficulty: tier, playerIndex: 0, actions: {}, rng: decisions,
        searchConfig: options.search, planUnitsPerMs: options.units, weights: { ...GRAVITY_WEIGHTS, ...options.weights } });
    const waves = [], fires = [], track = [], times = [];
    let attack = 0, lines = 0, later = 0, forecast = 0, mismatches = 0, wave = [], queue = [];
    const labels = new Map();
    let priorSlip = null, currentSlip = null, mistakeEnabled = 0, opportunity = 0;
    if (options.attribution) {
        const select = bot.chooseSelection.bind(bot);
        bot.chooseSelection = (ranked, full, tactics) => {
            const choice = select(ranked, full, tactics);
            const first = ranked[0];
            if (ranked.indexOf(choice) > 0 && !first.totalLines && !choice.totalLines) currentSlip = first.boardGrid;
            return choice;
        };
    }
    let waveBoards = [];
    const visibleRows = () => {
        const rows = state.boardGrid.map(row => row.map(cell => {
            if (!cell) return '.';
            if (!labels.has(cell.id)) labels.set(cell.id, String.fromCharCode(65 + labels.size % 26));
            return labels.get(cell.id);
        }).join(''));
        const top = rows.findIndex(r => /[^.]/.test(r));
        return top < 0 ? [] : rows.slice(top);
    };
    const callbacks = { spawnPiece: () => spawn(state), onLineClear: n => {
        wave.push(n); if (options.trace) waveBoards.push(visibleRows());
    },
        onGarbageReady: s => { attack += calculateGarbage(s).getTotalLines(); } };
    for (let lock = 0; lock < limit && !state.isGameOver; lock++) {
        currentSlip = null;
        const piece = options.attribution ? { ...state.currentPiece } : null;
        const before = state.score, start = performance.now(), plan = bot.plan();
        times.push(performance.now() - start);
        if (!plan) throw Error('No legal plan, seed ' + seed + ' lock ' + lock);
        const c = plan.candidate;
        queue = queue.filter(item => item.steps.shift() === pose(c));
        wave = []; waveBoards = [];
        await replay(state, plan.actions, callbacks);
        if (wave.length !== c.cascadeCount || (c.waves && !options.legacy
            && (wave.join() !== c.waves.map(w => w.lineCount ?? w).join() || c.score !== state.score - before - 50))) mismatches++;
        const total = wave.reduce((a, b) => a + b, 0);
        later += total - (wave[0] || 0);
        lines += total;
        waves[wave.length] = (waves[wave.length] || 0) + 1;
        const predicted = wave.length >= 2 && queue.some(q => q.steps.length === 0 && q.depth === wave.length);
        forecast += Number(predicted);
        if (options.attribution && wave.length >= 2 && !predicted) {
            if (priorSlip && !canMatchWaves(priorSlip, piece, wave.length)) mistakeEnabled++;
            else opportunity++;
        }
        priorSlip = currentSlip;
        queue = queue.filter(q => q.steps.length);
        if (!wave.length) {
            const steps = [];
            for (let f = c.futurePlan; f?.candidate; f = f.child) {
                steps.push(pose(f.candidate));
                if (f.candidate.cascadeCount >= 2) {
                    queue.push({ steps, depth: f.candidate.cascadeCount });
                    break;
                }
            }
        } else fires.push([lock + 1, ...wave]);
        if (options.trace) {
            const expected = [];
            for (let future = c.futurePlan; future?.candidate; future = future.child) {
                expected.push({ pose: pose(future.candidate), waves: future.candidate.cascadeCount });
            }
            track.push({ lock: lock + 1, shape: c.shapeKey, x: c.x, y: c.y, rotation: c.rotation,
                inputs: plan.actions, expected, waves: wave, waveBoards, rows: visibleRows(), score: state.score, attack });
        }
    }
    const result = { seed, tier, locks: times.length, fires, waves, lines, later, forecast, score: state.score,
        attack, mismatches, topOut: state.isGameOver, ms: Math.round(times.reduce((a, b) => a + b, 0)) };
    if (options.trace) result.track = track;
    if (options.attribution) Object.assign(result, { mistakeEnabled, opportunity });
    state.reset();
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [tier, first, count, limit, output, optionFile] = process.argv.slice(2);
    const options = optionFile ? JSON.parse(readFileSync(optionFile, 'utf8')) : {};
    writeFileSync(output, '', { flag: 'wx' });
    for (let i = 0; i < Number(count); i++) {
        appendFileSync(output, JSON.stringify(await play(Number(first) + i, Number(tier), Number(limit), options)) + '\n');
    }
}
