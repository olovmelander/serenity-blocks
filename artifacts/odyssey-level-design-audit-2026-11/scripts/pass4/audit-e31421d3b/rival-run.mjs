// Pass 4 prototype: Odyssey rival matches against the live rival, with the older play or the versus play.
// Usage: node rival-run.mjs <config.json> <out.jsonl> [workers]
// The config: { orbs: [5, ...], seeds: "12001+5,13001+5", cells: "gates" | "paces" | [[profile, cadence], ...],
//   rival: { play: "classic" | "versus", kill: "spawn" | "roof", planning: "odyssey" | "versus",
//            weights: {...}, perOrb: { "60": { tier, judgment, maxApm, reactionMs, play, ... } } } }
// Nothing in src/ is changed: the rival is set up through runAttempt's configureRival hook.
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAttempt } from '../../../../scripts/odyssey-benchmark/runtime.mjs';
import { applyGarbage, spawnPiece } from '../../../../src/core/game.js';
import { readMinAttackLines } from '../../../../src/core/garbage.js';
import { VERSUS_WEIGHTS, rowsToBlockSpawn } from '../../../../src/core/ai/versus-evaluation.js';
import { gravityPlanningRate, VERSUS_ROOF_PLANNING } from '../../../../src/core/ai/gravity-bot-controller.js';
import { LocalBotManager } from '../../../../src/core/ai/local-bot-manager.js';
import { applyVersusFeel } from '../../../../src/core/multiplayer/versus-rules.js';
import { HIDDEN_ROWS } from '../../../../src/core/constants.js';
import { BenchmarkBot } from '../../../../scripts/odyssey-benchmark/profiles.mjs';

// cells "levels:4,5,6": the player's well is played by a local versus bot of that level, built by the
// game's own LocalBotManager (its hands, its practice chance, the versus play), in place of a stand-in.
// It is taught Odyssey's rule for rising rows, as a person in a duel would know it.
let seat = null;
const standInUpdate = BenchmarkBot.prototype.update;
const standInReset = BenchmarkBot.prototype.reset;
function roomAbove(grid) {
    const roof = grid.findIndex((row) => row.some(Boolean));
    return (roof < 0 ? grid.length : roof) - HIDDEN_ROWS;
}
function seatLocalBot(standIn) {
    const { duel, level, seed } = seat;
    const match = duel.multiplayer;
    const manager = new LocalBotManager({
        multiplayerState: match, actionFactory: (index) => (index === 0 ? standIn.actions : null), useLocalStyles: true,
    });
    // The manager reads its seed here only; an Odyssey duel deals its pieces from each well's own stream.
    const kept = match.sharedPieceSeed;
    match.sharedPieceSeed = seed;
    manager.configure([{ kind: 'bot', difficulty: level }, { kind: 'human' }], seed);
    match.sharedPieceSeed = kept;
    const controller = manager.controllers.get(0);
    controller.versusOutlook = () => ({
        ...manager.versusOutlook(0),
        ...(!seat.spill && {
            killRows: Math.max(1, roomAbove(duel.players[1].boardGrid) + 1 - match.getGarbageQueue(1).getTotalLines()),
            refuseRows: true,
        }),
    });
    seat.controller = controller;
    seat.judgmentTier = controller.config.tier;
}
BenchmarkBot.prototype.update = function update(delta, now) {
    if (!seat) return standInUpdate.call(this, delta, now);
    if (!seat.controller) seatLocalBot(this);
    return seat.controller.update(delta, now);
};
BenchmarkBot.prototype.reset = function reset() {
    seat?.controller?.reset();
    return standInReset.call(this);
};

const GATES = [['stacker', 'deliberate'], ['stacker', 'native'], ['cascade', 'steady'], ['expert', 'native'], ['quad', 'native']];
const PACES = ['stacker', 'cascade'].flatMap((p) => ['human-casual', 'human-regular', 'human-strong'].map((c) => [p, c]));

function columnTops(grid) {
    const tops = [];
    for (let x = 0; x < grid[0].length; x++) {
        let y = 0;
        while (y < grid.length && !grid[y][x]) y++;
        tops.push(grid.length - y);
    }
    return tops;
}

/** Set the rival up after the match built it. Returns the tallies this run reads at the end. */
function configure(duel, settings) {
    const { bot } = duel;
    const tally = { deaths: [], botPieces: 0, humanPieces: 0, plans: 0, big: [0, 0], biggest: [0, 0] };
    const attacked = duel.multiplayer.onAttack;
    duel.multiplayer.onAttack = (index, targets, rows) => {
        if (rows >= 4) tally.big[index]++;
        tally.biggest[index] = Math.max(tally.biggest[index], rows);
        return attacked?.(index, targets, rows);
    };
    if (settings.maxApm) {
        bot.config.maxApm = settings.maxApm;
        bot.config.actionIntervalMs = 60000 / settings.maxApm;
    }
    if (settings.reactionMs) bot.config.reactionMs = [...settings.reactionMs];
    if (settings.mistakeChance !== undefined) bot.config.mistakeChance = settings.mistakeChance;
    if (settings.play === 'versus') {
        bot.versusWeights = { ...VERSUS_WEIGHTS, ...settings.weights };
        bot.versusOutlook = () => {
            const waiting = duel.multiplayer.getGarbageQueue(0).getTotalLines();
            // 'roof': Odyssey's own rule, a burst that lifts any cell above the visible rows ends the player.
            const killRows = settings.kill === 'roof'
                ? Math.max(1, bot.opponentRoom() + 1 - waiting)
                : rowsToBlockSpawn(duel.players[0].boardGrid, waiting);
            return {
                minAttackLines: readMinAttackLines(duel.multiplayer.matchConfig?.minAttackLines),
                worth: 1,
                flat: false,
                killRows,
                ...(settings.refuse && { refuseRows: true, refuseRoom: settings.refuseRoom }),
            };
        };
        if (settings.planning !== 'odyssey') {
            bot.planUnitsPerMs = gravityPlanningRate(2, bot.config.tier, true);
            bot.roofPlanningRate = VERSUS_ROOF_PLANNING;
        }
    }
    // feel "versus": both wells draw each piece on its own and lock a resting piece at the next gravity step,
    // as local versus does (a duel rule tried here, not Odyssey's).
    if (settings.feel === 'versus') duel.players.forEach(applyVersusFeel);
    if (settings.overflow === 'spill') {
        // The versus death rule (ADR-0024) tried in an Odyssey duel: arriving rows always go in, cells lifted past
        // the top are lost, and only a piece that cannot appear ends a well. Otherwise the match's own method.
        duel._spawnWithGarbage = (index) => {
            const state = duel.players[index];
            if (state.isGameOver) return;
            const queue = duel.multiplayer.garbageQueues[index];
            const entries = [];
            let burst = queue.dequeueLineBurst();
            while (burst.length) {
                entries.push(...burst);
                burst = queue.dequeueLineBurst();
            }
            if (entries.length) {
                applyGarbage(state, entries, { overflowPolicy: 'spill' });
                duel._callVisual(index, 'onGarbageApplied', entries.length);
            }
            spawnPiece(state, index === 0 ? duel.onPieceSpawn : null, () => duel.markTopOut(index));
        };
    }
    // Why each well ended: rows arriving that the well refused, or a piece that could not appear.
    const mark = duel.markTopOut.bind(duel);
    duel.markTopOut = (index) => {
        const fresh = !duel.pendingDeaths.has(index) && duel.players[index]?.isAlive;
        if (fresh) {
            const tops = columnTops(duel.players[index].boardGrid);
            const stack = new Error().stack || '';
            tally.deaths.push({
                who: index ? 'rival' : 'player',
                // A piece that could not appear ends the well inside game.js's own spawnPiece.
                cause: stack.split('\n').some((line) => line.includes('at spawnPiece') && line.includes('game.js'))
                    ? 'spawn' : 'rows',
                tallest: Math.max(...tops),
                centre: Math.max(...tops.slice(3, 7)),
                edge: Math.max(tops[0], tops[tops.length - 1]),
                round: duel.round,
            });
        }
        mark(index);
    };
    const adopt = bot.adoptPlan.bind(bot);
    bot.adoptPlan = (plan) => { tally.plans++; return adopt(plan); };
    const barrier = duel._beginRoundBarrier.bind(duel);
    duel._beginRoundBarrier = () => {
        if (!duel.transition) {
            tally.botPieces += duel.players[1].piecesPlaced || 0;
            tally.humanPieces += duel.players[0].piecesPlaced || 0;
        }
        barrier();
    };
    return tally;
}

if (process.send) {
    console.log = () => {};
    console.debug = () => {};
    process.on('message', async ({ id, task }) => {
        try {
            const settings = { ...task.rival, ...task.rival?.perOrb?.[task.orb] };
            delete settings.perOrb;
            let tally;
            const level = task.profile === 'local' ? Number(task.cadence.split('-')[1]) : 0;
            seat = level ? { level, seed: task.seed } : null;
            const attempt = await runAttempt({
                levelId: task.orb,
                seed: task.seed,
                profile: level ? 'stacker' : task.profile,
                cadenceId: level ? 'native' : task.cadence,
                liveRival: true,
                rivalTier: settings.tier,
                judgment: settings.judgment,
                wallBudgetMs: 3600000,
                maxSimSeconds: 1800,
                maxPieces: 3000,
                configureRival: (duel) => {
                    tally = configure(duel, settings);
                    if (seat) {
                        seat.duel = duel;
                        seat.spill = settings.overflow === 'spill';
                    }
                },
            });
            const judgmentTier = seat?.judgmentTier;
            seat = null;
            if (attempt.outcome === 'error') throw Error(`${task.orb}/${task.seed}/${task.cadence}: ${attempt.reason}`);
            const duel = attempt.duel || {};
            const players = duel.telemetry?.players || [];
            process.send({
                id,
                result: {
                    orb: task.orb,
                    seed: task.seed,
                    profile: task.profile,
                    cadence: task.cadence,
                    outcome: attempt.outcome,
                    reason: attempt.reason,
                    stars: attempt.stars,
                    seconds: attempt.metrics?.time,
                    activeSeconds: duel.telemetry?.activeSeconds,
                    frags: [duel.playerFrags, duel.botFrags],
                    rounds: duel.round,
                    rowsSent: players.map((p) => p.attackLinesSent),
                    attacks: players.map((p) => p.attacksSent),
                    uncredited: players.map((p) => p.uncreditedDeaths),
                    pieces: [tally?.humanPieces, tally?.botPieces],
                    big: tally?.big,
                    biggest: tally?.biggest,
                    deaths: tally?.deaths,
                    wallMs: Math.round(attempt.wallMs),
                    ...(judgmentTier && { judgmentTier }),
                },
            });
        } catch (error) { process.send({ id, error: error.stack }); }
    });
} else {
    const [configPath, out, workers = '8'] = process.argv.slice(2);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    let cells = config.cells || 'paces';
    if (cells === 'gates') cells = GATES;
    else if (cells === 'paces') cells = PACES;
    else if (cells === 'all') cells = [...GATES, ...PACES];
    else if (typeof cells === 'string' && cells.startsWith('levels:')) {
        cells = cells.slice(7).split(',').map((n) => ['local', `level-${Number(n)}`]);
    }
    const key = (r) => [r.orb, r.seed, r.profile, r.cadence].join('/');
    const done = new Set(existsSync(out)
        ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((line) => key(JSON.parse(line))) : []);
    const tasks = [];
    for (const block of config.seeds.split(',')) {
        const [start, count] = block.split('+').map(Number);
        for (let seed = start; seed < start + count; seed++) {
            for (const orb of config.orbs) {
                for (const [profile, cadence] of cells) {
                    const task = { orb, seed, profile, cadence, rival: config.rival || {} };
                    if (!done.has(key(task))) tasks.push(task);
                }
            }
        }
    }
    // Long matches first, so the tail of the run is short ones.
    tasks.sort((a, b) => b.orb - a.orb);
    const total = tasks.length;
    let finished = 0;
    let failed = 0;
    const started = Date.now();
    await new Promise((resolveAll) => {
        let alive = 0;
        const next = (child) => {
            const task = tasks.shift();
            if (!task) {
                child.kill();
                if (--alive === 0) resolveAll();
                return;
            }
            child.send({ id: 0, task });
        };
        const count = Math.min(Number(workers), total) || 0;
        if (!count) resolveAll();
        for (let i = 0; i < count; i++) {
            const child = fork(fileURLToPath(import.meta.url), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
            alive++;
            child.on('message', ({ result, error }) => {
                if (error) {
                    failed++;
                    console.error(error);
                } else appendFileSync(out, JSON.stringify(result) + '\n');
                finished++;
                if (finished % 20 === 0 || finished === total) {
                    console.log(`${finished}/${total} after ${Math.round((Date.now() - started) / 1000)} s`);
                }
                next(child);
            });
            next(child);
        }
    });
    console.log(`done: ${finished} matches, ${failed} failed, ${Math.round((Date.now() - started) / 1000)} s`);
    process.exit(failed ? 1 : 0);
}
