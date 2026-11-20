// Audit instruments for the November 2026 baseline. Run from the repository root.
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { GameState, spawnPiece, fillBag, hardDrop, softDrop, move, rotate } from '../../src/core/game.js';
import { calculateGarbage } from '../../src/core/garbage.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { findConnectedComponents } from '../../src/core/cascade-helpers.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { reachableLandings } from '../../src/core/stillfall/stillfall-reach.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { demonstrateConstruction } from '../../scripts/odyssey-benchmark/capabilities.mjs';

export function deal(seed) {
    const state = new GameState({ disableLevelProgression: true, hitStopEnabled: false, lockBonusPolicy: 'legacy-max' });
    state.isSeeking = true;
    bindLegacySessionRng(state, seed);
    fillBag(state.nextPieces, state.randomGenerator);
    spawn(state);
    return state;
}

export function spawn(state) {
    return spawnPiece(state, null, () => { state.isGameOver = true; });
}

export function controls(state, callbacks) {
    return {
        moveLeft: () => move(state, -1),
        moveRight: () => move(state, 1),
        rotateLeft: () => rotate(state, 'left'),
        rotateRight: () => rotate(state, 'right'),
        rotateFlip: () => rotate(state, 'flip'),
        softDrop: () => softDrop(state, null, callbacks),
        hardDrop: () => hardDrop(state, null, callbacks),
    };
}

export async function replay(state, actions, callbacks) {
    const before = state.piecesPlaced;
    for (const action of actions) {
        let accepted;
        switch (action.type) {
        case 'move': accepted = move(state, action.dir); break;
        case 'rotate': accepted = rotate(state, action.dir); break;
        case 'softDrop': accepted = softDrop(state, null, callbacks); break;
        case 'hardDrop': accepted = hardDrop(state, null, callbacks); break;
        default: throw new Error('Unknown input');
        }
        if (!accepted) throw new Error('Rejected input ' + JSON.stringify(action));
    }
    await state.latestPhysicsPromise;
    if (!state.isGameOver && before + 1 !== state.piecesPlaced) throw new Error('Expected exactly one lock');
}

export function pose(c) {
    return [c.shapeKey, c.rotation, c.x, c.y].join('/');
}

// Instrument final choice without drawing random numbers or changing either ranking.
class ObservedBot extends PuzzleBotController {
    chooseSelection(ranked, full, tactics) {
        const c = super.chooseSelection(ranked, full, tactics);
        this.choice = { rank: ranked.indexOf(c), first: ranked[0],
            minimumWaves: Math.min(...full.map(candidate => candidate.cascadeCount)) };
        return c;
    }
}

function fresh() {
    return { locks: 0, score: 0, attack: 0, lines: 0, lateLines: 0, waves: [], singles: 0,
        forecastFires: 0, committedFires: 0, forecastBuilds: 0, committedBuilds: 0,
        overridesOrOmitted: 0, belowFirst: 0, farBelowFirst: 0, predictedWaveErrors: 0,
        mistakeEnabled: 0, unforecastForced: 0, topOut: false };
}

export function canMatchWaves(board, piece, depth) {
    const bodies = findConnectedComponents(board);
    return reachableLandings(board, piece).some(p =>
        resolveCascade([...bodies, { ...p, shapeKey: piece.shapeKey, pieceId: 'alternative' }]).cascadeCount >= depth);
}

export async function tierRun(seed, tier, limit) {
    if (!Number.isInteger(tier) || tier < 1 || tier > 10) throw new RangeError('Expected tier 1 through 10');
    const state = deal(seed);
    const bot = new ObservedBot({ playerState: state, playerIndex: 0, difficulty: tier,
        actions: {}, rng: seededRandom((seed ^ 0x85ebca6b) >>> 0) });
    const metrics = fresh();
    const snapshots = {};
    let forecasts = [];
    let alternative = null;
    let waveLines = [];
    const callbacks = {
        spawnPiece: () => spawn(state),
        onLineClear: (lines) => waveLines.push(lines),
        onGarbageReady: (summary) => { metrics.attack += calculateGarbage(summary).getTotalLines(); },
    };
    while (!state.isGameOver && metrics.locks < limit) {
        waveLines = [];
        const plan = bot.plan();
        if (!plan) throw new Error('Valid spawn had no plan');
        const selected = plan.candidate;
        const piece = { ...state.currentPiece };
        const key = pose(selected);
        forecasts = forecasts.filter((route) => route.steps.shift() === key);
        await replay(state, plan.actions, callbacks);
        const depth = waveLines.length;
        const total = waveLines.reduce((a, b) => a + b, 0);
        metrics.locks++;
        metrics.waves[depth] = (metrics.waves[depth] || 0) + 1;
        metrics.lines += total;
        metrics.singles += Number(total === 1);
        metrics.lateLines += total - (waveLines[0] || 0);
        metrics.score = state.score;
        metrics.topOut = state.isGameOver;
        metrics.predictedWaveErrors += Number(depth !== selected.cascadeCount || total !== selected.totalLines);
        const matches = forecasts.filter((r) => !r.steps.length && r.depth === depth && depth >= 2);
        metrics.forecastFires += Number(matches.length > 0);
        metrics.committedFires += Number(matches.some((r) => r.committed));
        if (depth >= 2 && matches.length === 0) {
            metrics.unforecastForced += Number(bot.choice.minimumWaves >= depth);
            if (alternative && !canMatchWaves(alternative, piece, depth)) metrics.mistakeEnabled++;
        }
        // A below-first no-clear choice is a sampled slip on tiers without a hard GO.
        // Compare with the first choice only when that choice also left the board uncleared.
        alternative = !depth && bot.choice.rank > 0 && bot.choice.first.totalLines === 0
            && !bot.config.buildVsFire ? bot.choice.first.boardGrid : null;
        forecasts = forecasts.filter((r) => r.steps.length > 0);
        if (bot.choice.rank < 0) metrics.overridesOrOmitted++;
        if (bot.choice.rank > 0) {
            metrics.belowFirst++;
            metrics.farBelowFirst += Number(Math.abs(selected.x - bot.choice.first.x) >= 3);
        }
        if (!depth) {
            const steps = [];
            for (let future = selected.futurePlan; future?.candidate; future = future.child) {
                steps.push(pose(future.candidate));
                if (future.candidate.cascadeCount >= 2) {
                    forecasts.push({ steps: [...steps], depth: future.candidate.cascadeCount, committed: !!bot.machinePlan });
                    metrics.forecastBuilds++;
                    metrics.committedBuilds += Number(!!bot.machinePlan);
                    break;
                }
            }
        }
        if (metrics.locks === 16) snapshots.opening = structuredClone(metrics);
    }
    snapshots.opening ||= structuredClone(metrics);
    if (limit > 16) snapshots.long = metrics;
    state.reset();
    return { seed, tier, ...snapshots };
}

export async function expertRun(seed) {
    const result = await demonstrateConstruction({ profileId: 'expert', seed, maxPieces: 16 });
    return { seed, expert: true, waves: result.maximumDepth, locks: result.piecesPlaced,
        topOut: result.topOut, rejected: result.rejectedActions, replay: result.preparedReplay?.status ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [mode, first, count, output] = process.argv.slice(2);
    writeFileSync(output, '', { flag: 'wx' });
    for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
        const longPanel = seed >= 1001 && seed <= 1008;
        const result = mode === 'expert' ? await expertRun(seed) : await tierRun(seed, Number(mode), longPanel ? 120 : 16);
        appendFileSync(output, JSON.stringify(result) + '\n');
    }
}
