// Compare two real local managers on a fixed clock. Both seats must have a
// legal hard drop ready before the next joint lock is released.
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import { betweenTickFrames } from './recorded-seat.mjs';

const [baseline, output, first = '2034101', count = '20', duration = '150'] = process.argv.slice(2);
if (!baseline || !output) throw Error('Pass BASELINE_CHECKOUT OUTPUT.jsonl [FIRST_SEED COUNT GAME_SECONDS]');
const { LocalBotManager: PreviousManager } = await import(pathToFileURL(resolve(baseline, 'src/core/ai/local-bot-manager.js')));
writeFileSync(output, '', { flag: 'wx' });
console.log = () => {};
console.debug = () => {};
for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
    for (const candidate of [0, 1]) {
        const ready = [false, false];
        const permits = [false, false];
        const locks = [[], []];
        const scores = [0, 0];
        const plans = [0, 0];
        let tick = 0;
        let samePiecePairs = 0;
        let forcedLock = false;
        let control;
        try {
            const result = await duel(9, seed, Boolean(candidate), Number(duration), {
                tiers: [10, 10], live: true, fixed: true, useLocalStyles: false,
                stopAfterTick: () => forcedLock,
                observeManager(manager) {
                    const old = 1 - candidate;
                    control = new PreviousManager({ multiplayerState: manager.multiplayerState,
                        useLocalStyles: false, actionFactory: manager.actionFactory });
                    control.configure([{ kind: 'bot', difficulty: 10 }, { kind: 'bot', difficulty: 10 }]);
                    const oldBot = control.controllers.get(old);
                    // The current manager owns fixed tick input emission for both seats.
                    oldBot.scheduler.actions = manager.controllers.get(old).scheduler.actions;
                    manager.controllers.set(old, oldBot);
                    for (const [index, bot] of manager.controllers) {
                        bot.config.actionIntervalMs = 60000 / 850;
                        bot.config.reactionMs = [170, 250];
                        bot.scheduler.variation = null;
                        const update = bot.scheduler.update.bind(bot.scheduler);
                        bot.scheduler.update = delta => {
                            if (bot.scheduler.queue[0]?.type !== 'hardDrop') {
                                ready[index] = false;
                                return update(delta);
                            }
                            if (!bot.scheduler.canLock()) {
                                ready[index] = false;
                                return update(delta);
                            }
                            if (!permits[index]) {
                                bot.scheduler.cooldownMs = Math.max(0, bot.scheduler.cooldownMs - delta);
                                ready[index] = bot.scheduler.cooldownMs === 0;
                                return false;
                            }
                            const done = update(delta);
                            if (done) {
                                locks[index].push(tick);
                                permits[index] = false;
                                ready[index] = false;
                            }
                            return done;
                        };
                        const adopt = bot.adoptPlan.bind(bot);
                        bot.adoptPlan = plan => { plans[index]++; return adopt(plan); };
                    }
                },
                afterFixedTick(manager, fixedTick, stats) {
                    // Physics callbacks (including garbage insertion) finish before a new
                    // pair of locks is released. Validate the two actual deals at release.
                    tick = fixedTick;
                    manager.multiplayerState.players.forEach((state, i) => { scores[i] = state.score; });
                    // A natural lock can expire while the other board is still animating.
                    // Censor the round at the first such lock; playing on would compare different pieces.
                    forcedLock = stats.some((s, i) => s.locks > locks[i].length);
                    if (forcedLock) return;
                    if (ready.every(Boolean) && !permits.some(Boolean)) {
                        const pieces = manager.multiplayerState.players.map(s => s.currentPiece?.shapeKey);
                        if (!pieces[0] || pieces[0] !== pieces[1]) throw Error('Different deals at tick ' + tick);
                        permits.fill(true);
                        samePiecePairs++;
                    }
                    betweenTickFrames(165, fixedTick, (ms, step) => manager.precomputeFixedSearch(ms, step));
                },
            });
            const shared = Math.min(locks[0].length, locks[1].length);
            const maxLockSkew = locks[0].slice(0, shared).reduce((max, value, i) =>
                Math.max(max, Math.abs(value - locks[1][i])), 0);
            const row = { seed, candidate, ticks: result.ticksPlayed, lost: result.lost, scores,
                stats: result.stats.map(({ locks: n, sent, applied, dugCells }) => ({ locks: n, sent, applied, dugCells })),
                plans, samePiecePairs, commandedLocks: locks.map(r => r.length), maxLockSkew, forcedLock };
            // A losing well may lock itself under gravity before the next pair is released.
            // Its loss is real. Every scheduled placement before that must be simultaneous.
            if (maxLockSkew || locks[0].length !== locks[1].length || result.stats.some((s, i) =>
                s.locks !== locks[i].length && !((forcedLock || result.lost[i]) && s.locks === locks[i].length + 1))) {
                throw Error('Unmatched lock timing: ' + JSON.stringify(row));
            }
            appendFileSync(output, JSON.stringify(row) + '\n');
        } finally { control?.destroy(); }
    }
}
