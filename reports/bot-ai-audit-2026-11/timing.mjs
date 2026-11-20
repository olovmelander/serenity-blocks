// Browser-only. Each sample encloses exactly one active controller update on a pinned board.
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { seededRandom } from '../../src/utils/helpers.js';

function signature(plan) {
    return JSON.stringify(plan.actions) + '/' + plan.candidate.rotation + '/' + plan.candidate.x + '/' + plan.candidate.y;
}

export function batch(fixtures, tier, units, hz, count, Controller = PuzzleBotController, fixed = null) {
    const times = [];
    const latencies = [];
    const choices = [];
    const work = [];
    const tickCounts = [];
    const frame = 1000 / hz;
    const quantum = 1000 / 60;
    let idleBatches = 0;
    for (const fixture of fixtures) {
        const bots = Array.from({ length: count }, (_, i) => {
            const accepted = () => true;
            const bot = new Controller({ playerState: fixed ? { ...fixture.state, useFixedCascade: true } : fixture.state,
                precomputeBetweenTicks: fixed?.prepare, playerIndex: i, difficulty: tier, actions: {
                moveLeft: accepted, moveRight: accepted, rotateLeft: accepted, rotateRight: accepted,
                rotateFlip: accepted, softDrop: accepted, hardDrop: accepted },
                configOverrides: tier === 8 ? { maxApm: 340, reactionMs: [150, 300] } : undefined,
                rng: seededRandom((fixture.seed ^ 0x85ebca6b ^ i) >>> 0), planUnitsPerMs: units });
            const steps = bot.planSteps.bind(bot);
            bot.visits = 0;
            bot.planSteps = function* countedSteps(...args) {
                const gen = steps(...args);
                for (;;) {
                    const step = gen.next();
                    this.visits++;
                    if (step.done) return step.value;
                    yield;
                }
            };
            return bot;
        });
        let ticks = 0;
        let credit = 0, simTicks = 0;
        const adopted = new Set();
        for (let tick = 0; tick < 1000; tick++) {
            const at = tick * frame;
            const before = bots.reduce((sum, b) => sum + b.visits, 0);
            const t0 = performance.now();
            let prepared = 0;
            if (fixed) {
                credit += frame;
                if (credit + 1e-7 < quantum) {
                    if (fixed.prepare) {
                        for (const bot of bots) if (!adopted.has(bot)) prepared += bot.precomputeSearch(frame, quantum);
                    }
                } else {
                    while (credit + 1e-7 >= quantum) {
                        credit = Math.max(0, credit - quantum);
                        simTicks++;
                        for (const bot of bots) if (!adopted.has(bot)) bot.update(quantum, simTicks * quantum);
                    }
                }
            } else {
                for (const bot of bots) if (!adopted.has(bot)) bot.update(frame, at);
            }
            const ms = performance.now() - t0;
            idleBatches += prepared;
            if (prepared || before < bots.reduce((sum, b) => sum + b.visits, 0)) { times.push(ms); ticks++; }
            for (const bot of bots) {
                if (bot.lastPlan && !adopted.has(bot)) {
                    adopted.add(bot);
                    latencies.push(Math.round(Math.max(0, (fixed ? simTicks * quantum : at) - bot.readyAtMs)));
                }
            }
            if (adopted.size === bots.length) break;
        }
        if (adopted.size !== bots.length) throw Error('Incomplete timing fixture ' + JSON.stringify({
            seed: fixture.seed, kind: fixture.kind, tier, hz, count, active: !!fixture.state.currentPiece,
            alive: fixture.state.isAlive, over: fixture.state.isGameOver, visits: bots.map(b => b.visits),
        }));
        work.push(bots.map(b => b.visits - 1));
        tickCounts.push(ticks);
        choices.push(bots.map(b => signature(b.lastPlan)));
    }
    return { tier, units, hz, count, times, latencies, work, tickCounts, choices,
        ...(fixed ? { clock: 'fixed-local', prepare: fixed.prepare, idleBatches } : {}) };
}

export function sample(fixtures, repeat) {
    const specs = [[8, 0, 60, 1], [8, 2.5, 60, 1], [8, 2.5, 165, 1], [10, 0, 60, 1],
        [10, 2.5, 60, 1], [10, 2.5, 165, 1], [10, 0, 60, 3]];
    for (const spec of specs) batch(fixtures.slice(0, 3), ...spec);
    return (repeat % 2 ? specs.reverse() : specs).map(spec => batch(fixtures, ...spec));
}
