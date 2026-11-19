// Repeat the survival and adjacent-pair panels with bounded parallelism. Each
// row is emitted as it finishes so a long run can resume on the same revision.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { play } from './run.mjs';
import { liveOpening } from './live-openings.mjs';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import { localBotRoundSeed } from '../../src/core/ai/local-bot-manager.js';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { HIDDEN_ROWS } from '../../src/core/constants.js';
import { resolveLocalMatchEnd } from '../../src/core/game-modes/local-match-rules.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';

async function perform(task) {
    const { mode, tier, seed, swap } = task;
    const scheduled = mode === 'scheduled' || mode === 'scheduledLegacy';
    const fragRace = mode === 'frags' || mode === 'legacyFrags';
    const commonPace = mode === 'common' || mode === 'commonJudgment';
    if (scheduled || mode === 'ladder' || mode === 'legacyLadder' || commonPace || fragRace) {
        const useLocalStyles = !(task.tempoSpread || task.styleRange || task.nativeApm || task.judgmentOdds
            || task.practicedSlots || mode === 'common');
        const styleDraw = slot => seededRandom((Math.imul(seed, 0x85ebca6b) ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0)();
        const configure = (bot, selectedTier) => {
            const practicedInterval = bot.config.actionIntervalMs;
            if (task.nativeApm?.[selectedTier]) bot.config.actionIntervalMs = 60000 / task.nativeApm[selectedTier];
            if (task.reactionMaxAdd?.[selectedTier]) {
                const [minimum, maximum] = bot.config.reactionMs;
                bot.config.reactionMs = [minimum, maximum + task.reactionMaxAdd[selectedTier]];
            }
            if (task.styleRange > 0 || task.judgmentOdds || task.practicedSlots) {
                const ordinary = new GravityBotController({ playerState: bot.playerState, difficulty: selectedTier, actions: {} });
                bot.config.actionIntervalMs = (task.judgmentOdds || task.practicedSlots) && task.nativeApm?.[selectedTier]
                    ? 60000 / task.nativeApm[selectedTier] : ordinary.config.actionIntervalMs;
                bot.config.reactionMs = ordinary.config.reactionMs;
            }
            if (commonPace) {
                bot.config.reactionMs = [200, 300];
                bot.config.actionIntervalMs = 180;
                if (mode === 'commonJudgment') {
                    // Keep the reading style chosen by the normal local manager.
                    // Both seats now use exactly the same physical input interval.
                    bot.localPace = null;
                    bot.scheduler.variation = null;
                }
            }
            if (task.tempoSpread && (!task.steadyExpert || selectedTier !== 10)) {
                const rng = seededRandom((Math.imul(seed, 0x9e3779b1) ^ Math.imul(bot.playerIndex + 1, 0x27d4eb2d)) >>> 0);
                const variation = task.centerJudgment ? 1 - 2 * styleDraw(bot.playerIndex) : 2 * rng() - 1;
                const pace = Math.exp(variation * Math.abs(task.tempoSpread));
                if (task.tempoSpread > 0) bot.config.actionIntervalMs *= pace;
                else {
                    // Try a persistent, bounded execution style without changing the visible pieces or search.
                    const ordinaryInterval = Math.max(65, Math.min(950, bot.config.actionIntervalMs * pace));
                    bot.config.actionIntervalMs = ordinaryInterval;
                    if (task.checkBeforeDrop) {
                        const advance = bot.scheduler.update.bind(bot.scheduler);
                        bot.scheduler.update = delta => {
                            const queue = bot.scheduler.queue;
                            if (!bot.checkedDrop && queue.length === 1 && queue[0].type === 'hardDrop') {
                                const moves = Math.max(0, (bot.lastPlan?.actions.length || 1) - 1);
                                bot.scheduler.cooldownMs += Math.min(1800, bot.dropHesitation
                                    + moves * Math.max(0, ordinaryInterval - bot.config.actionIntervalMs));
                                bot.checkedDrop = true;
                            }
                            return advance(delta);
                        };
                    }
                    const step = bot.stepSlicedPlan.bind(bot);
                    bot.stepSlicedPlan = (delta, now) => {
                        const spawn = bot.currentSpawnToken;
                        if (bot.styledSpawn !== spawn) {
                            bot.styledSpawn = spawn;
                            const minimum = task.tempoSpread < -1 ? bot.config.reactionMs[0] : 110;
                            // Under a low ceiling, stop hesitating and use the well-practised
                            // timing. This is an observation of this seat's own stack at spawn.
                            const roof = task.safeRoom && bot.playerState.boardGrid.findIndex(row => row.some(Boolean));
                            const threatened = task.safeRoom && roof >= 0 && roof - HIDDEN_ROWS <= task.safeRoom;
                            const alignAtPracticeSpeed = threatened || task.checkBeforeDrop;
                            bot.config.actionIntervalMs = alignAtPracticeSpeed ? Math.min(ordinaryInterval, practicedInterval) : ordinaryInterval;
                            const raw = bot.readyAtMs - now;
                            const reactionPace = alignAtPracticeSpeed ? Math.min(1, pace) : pace;
                            const delay = Math.max(minimum, Math.min(1150, raw * reactionPace));
                            bot.dropHesitation = Math.max(0, Math.min(1150, raw * pace) - delay);
                            bot.checkedDrop = false;
                            bot.readyAtMs = now + delay;
                        }
                        step(delta, now);
                    };
                }
            }
        };
        const slotTier = (selected, slot) => {
            if (task.practicedSlots || task.judgmentOdds) {
                const practiced = task.practicedSlots ? task.practicedSlots[slot] : styleDraw(slot) < task.judgmentOdds[selected];
                return practiced ? Math.min(10, selected + 2) : selected;
            }
            if (!task.styleRange) return selected;
            const u = styleDraw(slot);
            if (task.centerJudgment) {
                if (task.steadyExpert && selected === 10) return selected;
                const minimum = Math.max(1, selected - task.styleRange, selected >= 8 ? selected - 1 : 1);
                const maximum = Math.min(10, selected + task.styleRange);
                return minimum + Math.floor(u * (maximum - minimum + 1));
            }
            if (task.styleRange < 0) return selected + Math.floor(u * Math.min(-task.styleRange, 11 - selected));
            return Math.min(10, selected + Math.floor(u * task.styleRange));
        };
        if (scheduled) {
            const actual = task.judgmentOdds || task.practicedSlots ? slotTier(tier, 0) : tier;
            const result = liveOpening(seed, task.limit, false, mode === 'scheduledLegacy', actual, bot => configure(bot, tier), useLocalStyles);
            return { ...result, tier };
        }
        const match = new MultiPlayerState(2);
        match.matchConfig = { ...match.matchConfig, endCondition: 'frags', endConditionValue: 3 };
        const rounds = [];
        for (let round = 1; round <= (fragRace ? 15 : 1); round++) {
            const game = await duel(tier, localBotRoundSeed(seed, round), swap, task.limit,
                { live: !mode.startsWith('legacy'), fixed: true, configure, slotTier, seriesSeed: seed, useLocalStyles });
            rounds.push(game);
            if (!fragRace) return game;
            if (!game.lost.some(Boolean)) return { winner: null, censored: 'round-time', frags: match.frags, rounds };
            match.lastAttackerIds = [...game.attackers];
            match.handlePlayerDeaths([0, 1].filter(index => game.lost[index]));
            const standings = match.frags.map((frags, index) => ({ result: index, frags }));
            const winner = resolveLocalMatchEnd(match.matchConfig, standings, 0);
            if (winner !== null) return { winner: game.tiers[winner] ?? null, frags: match.frags, rounds };
            match.players.forEach(p => { p.isAlive = true; p.isGameOver = false; });
        }
        return { winner: null, censored: 'round-limit', frags: match.frags, rounds };
    }
    return play(seed, tier, task.limit, { legacy: mode === 'legacy' });
}
if (process.send) {
    console.debug = () => {}; console.log = () => {};
    process.on('message', async ({ id, task }) => {
        try { process.send({ id, result: await perform(task) }); }
        catch (error) { process.send({ id, error: error.stack }); }
    });
} else if (process.argv[2] === 'check-frags') {
    const [input, output] = process.argv.slice(3);
    const matches = readFileSync(input, 'utf8').trim().split('\n').map(JSON.parse);
    let rounds = 0;
    for (const { task, row } of matches) {
        const frags = [0, 0];
        let leader = null;
        for (const round of row.rounds) {
            if (leader !== null) throw Error('Played past the winning frag on bag ' + task.seed);
            rounds++;
            round.lost.forEach((lost, index) => {
                const scorer = round.attackers[index];
                if (lost && scorer === 1 - index) frags[scorer]++;
            });
            leader = resolveLocalMatchEnd({ endCondition: 'frags', endConditionValue: 3 },
                round.tiers.map((tier, index) => ({ result: tier, frags: frags[index] })), 0);
        }
        if ((leader === 'draw' ? null : leader) !== row.winner || frags.some((value, i) => value !== row.frags[i])) {
            throw Error('Different frag tally on bag ' + task.seed);
        }
    }
    writeFileSync(output, JSON.stringify({ matches: matches.length, rounds, matched: true }), { flag: 'wx' });
} else {
    const [poolFile, mode, tiersArg, start, count, limit, output, concurrency = '3', tempoSpread = '0', styleRange = '0', optionFile] = process.argv.slice(2);
    const options = optionFile ? JSON.parse(readFileSync(optionFile, 'utf8')) : {};
    const { createPool } = await import(pathToFileURL(resolve(poolFile)));
    const pool = createPool(Number(concurrency), fileURLToPath(import.meta.url), process.env);
    const key = t => [t.mode, t.tier, t.seed, t.swap, t.limit, t.tempoSpread || 0, t.styleRange || 0,
        JSON.stringify(t.reactionMaxAdd || {}), JSON.stringify(t.nativeApm || {}), Boolean(t.steadyExpert),
        Boolean(t.centerJudgment), t.safeRoom ?? 0, Boolean(t.checkBeforeDrop),
        JSON.stringify(t.judgmentOdds || {}), JSON.stringify(t.practicedSlots || [])].join('/');
    const done = new Set(existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean)
        .map(line => key(JSON.parse(line).task)) : []);
    const file = openSync(output, 'a');
    const tasks = [];
    const seats = ['ladder', 'legacyLadder', 'common', 'commonJudgment', 'frags', 'legacyFrags'].includes(mode) ? [false, true] : [false];
    for (let i = 0; i < +count; i++) for (const tier of tiersArg.split(',').map(Number)) for (const swap of seats) {
        const task = { ...options, mode, tier, seed: Number(start) + i, swap, limit: +limit, tempoSpread: +tempoSpread, styleRange: +styleRange };
        if (!done.has(key(task))) tasks.push(task);
    }
    try {
        await Promise.all(tasks.map(async task => {
            const row = await pool.run(task);
            appendFileSync(file, JSON.stringify({ task, row }) + '\n');
        }));
    } finally { pool.close(); closeSync(file); }
}
