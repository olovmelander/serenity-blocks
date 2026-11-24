// Standard two-board, first top-out. Use the real local manager, input scheduler,
// gravity, attack router, spawn-boundary insertion and fixed virtual animation clock.
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { LocalBotManager } from '../../src/core/ai/local-bot-manager.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { processAutoDrop } from '../../src/core/game.js';
import { applyFixedLineImpactHitStop, applyFixedPerfectClearHitStop } from '../../src/core/fixed-hit-stop-policy.js';
import { retireFixedCascade } from '../../src/core/physics.js';
import { createLocalMultiplayerFixedTickRuntime, startLocalMultiplayerFixedTickRuntime,
    runLocalMultiplayerFixedTicks } from '../../src/core/game-modes/local-multiplayer-fixed-tick.js';
import { applyLocalMultiplayerFixedCommand } from '../../src/core/game-modes/local-multiplayer-loop.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { createVirtualClock } from '../../scripts/odyssey-benchmark/virtual-clock.mjs';
import { BOT_RESPAWN_MS } from '../../src/core/game-modes/local-ffa-respawn.js';
import { controls, spawn } from './solo.mjs';
import { dealVersus, notePlaced, takeGarbage, versusMatch, versusRules } from '../gravity-bot-rebuild/shipped-versus.mjs';

export async function duel(low, seed, swap, seconds = 150, options = {}) {
    if (!Number.isInteger(low) || low < 1 || low > 9) throw new RangeError('Expected the lower tier 1 through 9');
    const clock = createVirtualClock().install();
    const tiers = options.tiers ?? (swap ? [low + 1, low] : [low, low + 1]);
    const rules = versusRules(options.rules);
    // One round to its first top-out: the survivor game type, whichever rules are played.
    // options.fragTarget plays the shipped default instead: free-for-all to that many frags,
    // the dead back on an empty well after the local mode's own wait.
    const { fragTarget = 0 } = options;
    if (fragTarget && (rules !== 'shipped' || !options.fixed || !options.live)) {
        throw Error('Free-for-all needs the shipped rules, live bots and the fixed clock');
    }
    const mp = versusMatch(tiers.length, { rules, matchConfig: { ...(fragTarget
        ? { gameType: 'ffa', endCondition: 'frags', endConditionValue: fragTarget } : { gameType: 'survivor' }), ...options.matchConfig } });
    if (options.live) mp.sharedPieceSeed = seed;
    const frame = 1000 / 60;
    // For a pressure decision, count the queue when the planner runs.
    const stats = tiers.map(() => ({ locks: 0, plans: 0, queuedPlans: 0, queueSeen: 0, dangerQueued: 0,
        firedQueued: 0, incoming: 0, applied: 0, pendingOnLoss: 0, dugLocks: 0, dugCells: 0, sent: 0,
        ...(fragTarget && { deaths: 0, downTicks: 0 }) }));
    const garbageCells = state => state.boardGrid.reduce((n, row) =>
        n + row.filter((c) => c?.type === 'GARBAGE' || c?.type === 'CLEAN_GARBAGE').length, 0);
    let manager;
    try {
        const callbacks = mp.players.map((state, i) => {
            let beforeLock;
            state.disableLevelProgression = true;
            state.useFixedCascade = Boolean(options.fixed);
            dealVersus(state, seed);
            spawn(state);
            const own = {
                onHardDrop: () => { state.hitStopRemaining = Math.max(state.hitStopRemaining || 0, 30); },
                // The normal-motion local presentation applies the same 70 ms on a four-row wave.
                onLineClearImpact: lines => applyFixedLineImpactHitStop(state, lines),
                onPerfectClear: options.fixed ? () => applyFixedPerfectClearHitStop(state) : undefined,
                onPieceLock: (piece) => {
                    stats[i].locks++; beforeLock = garbageCells(state);
                    options.observe?.lock?.(i, piece, state, mp);
                    notePlaced(mp, i, rules);
                },
                onGarbageReady: (summary) => {
                    options.observe?.summary?.(i, summary, state, mp);
                    return mp.handleGarbageSummary(i, summary);
                },
                spawnPiece: () => {
                    const after = garbageCells(state);
                    if (beforeLock > after) {
                        stats[i].dugLocks++;
                        stats[i].dugCells += beforeLock - after;
                    }
                    const taken = takeGarbage(state, mp.getGarbageQueue(i), { rules, onGarbageReady: own.onGarbageReady });
                    stats[i].incoming += taken.rows;
                    options.observe?.rows?.(i, taken, state, mp);
                    if (taken.topOut) { state.isGameOver = true; return; }
                    stats[i].applied += taken.rows;
                    spawn(state);
                },
            };
            return own;
        });
        mp.onAttack = (from, _to, lines) => { stats[from].sent += lines; };
        const oldRng = seededRandom((seed ^ 0x85ebca6b) >>> 0);
        manager = new LocalBotManager({ multiplayerState: mp, useLocalStyles: options.useLocalStyles,
            actionFactory: i => controls(mp.players[i], callbacks[i]), rng: oldRng });
        manager.configure(tiers.map((tier, i) => ({
            kind: i < (options.botCount ?? tiers.length) ? 'bot' : 'human',
            difficulty: options.slotTier?.(tier, i) ?? tier,
        })), options.seriesSeed);
        if (!options.live) {
            for (const [i, bot] of manager.controllers) {
                // The original audit shared one decision stream. The fixed-clock
                // comparison pairs both policies on the live slot's own seed.
                manager.controllers.set(i, new PuzzleBotController({ actions: bot.actions, difficulty: tiers[i],
                    playerState: mp.players[i], playerIndex: i,
                    rng: options.fixed ? seededRandom((seed ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0) : oldRng }));
            }
        }
        for (const [i, bot] of manager.controllers) {
            if (options.configure) options.configure(bot, tiers[i]);
            if (options.live) {
                const adopt = bot.adoptPlan.bind(bot);
                bot.adoptPlan = plan => {
                    const incoming = mp.getGarbageQueue(i).getTotalLines();
                    stats[i].plans++;
                    if (incoming) {
                        stats[i].queuedPlans++;
                        stats[i].queueSeen += Number(bot.getPendingGarbage() === incoming);
                        stats[i].dangerQueued += Number(!!plan?.tactics?.danger);
                        stats[i].firedQueued += Number(plan?.candidate?.totalLines > 0);
                    }
                    return adopt(plan);
                };
                continue;
            }
            const choose = bot.plan.bind(bot);
            bot.plan = () => {
                const incoming = mp.getGarbageQueue(i).getTotalLines();
                const plan = choose();
                stats[i].plans++;
                if (incoming) {
                    stats[i].queuedPlans++;
                    stats[i].queueSeen += Number(bot.getPendingGarbage() === incoming);
                    stats[i].dangerQueued += Number(!!plan?.tactics.danger);
                    stats[i].firedQueued += Number(plan?.candidate.totalLines > 0);
                }
                return plan;
            };
        }
        options.observeManager?.(manager);
        const rounds = Math.round(seconds * 60);
        const runtime = options.fixed ? createLocalMultiplayerFixedTickRuntime() : null;
        const tickOptions = runtime && {
            ownership: startLocalMultiplayerFixedTickRuntime(runtime, mp),
            advanceInput: (i, context) => manager.advanceFixedInput(i, context),
            getPhysicsCallbacks: i => callbacks[i],
            applyInput: (i, command) => applyLocalMultiplayerFixedCommand(command, {
                gameState: mp.players[i], isEnabled: () => true, physicsCallbacks: callbacks[i] }),
        };
        let ticksPlayed = 0;
        const downSince = new Map();
        const playOnAfterDeaths = () => {
            const dead = mp.players.flatMap((s, i) => s.isAlive && s.isGameOver ? [i] : []);
            for (const i of mp.handlePlayerDeaths(dead)) {
                mp.players[i].currentPiece = null;
                mp.getGarbageQueue(i).clear();
                stats[i].deaths++;
                options.observe?.death?.(i, mp.players[i], mp);
                downSince.set(i, ticksPlayed);
            }
            if (Math.max(...mp.frags) >= fragTarget) return;
            for (const [i, since] of downSince) {
                stats[i].downTicks++;
                if ((ticksPlayed - since) * frame < BOT_RESPAWN_MS || !mp.respawnPlayer(i)) continue;
                downSince.delete(i);
                manager.resetPlayer(i);
                spawn(mp.players[i]);
            }
        };
        const unfinished = fragTarget ? () => Math.max(...mp.frags) < fragTarget : options.finishFfaRound
            ? () => mp.players.filter(s => s.isAlive && !s.isGameOver).length > 1
            : () => !mp.players.some(s => s.isGameOver);
        for (; ticksPlayed < rounds && unfinished(); ticksPlayed++) {
            await clock.advance(frame);
            if (runtime) {
                runLocalMultiplayerFixedTicks(runtime, frame, tickOptions);
                if (options.finishFfaRound) {
                    const lost = mp.players.flatMap((s, i) => s.isAlive && s.isGameOver ? [i] : []);
                    if (lost.length) mp.handlePlayerDeaths(lost).forEach(i => { mp.players[i].currentPiece = null; });
                }
                if (fragTarget) playOnAfterDeaths();
                options.afterFixedTick?.(manager, runtime.simFrame, stats);
                if (options.stopAfterTick?.()) { ticksPlayed++; break; }
                continue;
            }
            manager.update(frame, clock.now);
            for (let i = 0; i < mp.numPlayers; i++) {
                const state = mp.players[i];
                state.simTimeMs = (state.simTimeMs || 0) + frame;
                if (state.hitStopRemaining > 0) state.hitStopRemaining = Math.max(0, state.hitStopRemaining - frame);
                else if (!state.isProcessingPhysics && state.currentPiece && !state.isGameOver) {
                    processAutoDrop(state, frame, null, callbacks[i]);
                }
            }
            await clock.flush();
        }
        const lost = mp.players.map(s => s.isGameOver);
        const survivors = tiers.filter((_, i) => !lost[i]);
        const best = Math.max(...mp.frags);
        const leaders = tiers.filter((_, i) => mp.frags[i] === best);
        const decided = fragTarget ? best >= fragTarget && leaders.length === 1 && leaders : survivors.length === 1 && survivors;
        const winner = decided ? decided[0] : null;
        mp.players.forEach((s, i) => { stats[i].pendingOnLoss = s.isGameOver ? mp.getGarbageQueue(i).getTotalLines() : 0; });
        return { low, seed, swap, tiers, winner, simultaneous: lost.every(Boolean),
            attackers: [...mp.lastAttackerIds], lost, ticksPlayed, seconds: Math.round(clock.now / 1000), stats,
            ...(fragTarget && { frags: [...mp.frags], leader: leaders.length === 1 ? mp.frags.indexOf(best) : null }) };
    } finally {
        manager?.destroy();
        // Retire the players before draining any opponent animation still in progress.
        for (const state of mp.players) state.isStopped = true;
        mp.players.forEach(retireFixedCascade);
        await clock.settle(Promise.allSettled(mp.players.map(s => s.latestPhysicsPromise)));
        mp.players.forEach(s => s.reset());
        clock.restore();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [low, first, count, out] = process.argv.slice(2);
    writeFileSync(out, '', { flag: 'wx' });
    console.debug = () => {};
    for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
        for (const swap of [false, true]) appendFileSync(out, JSON.stringify(await duel(Number(low), seed, swap)) + '\n');
    }
}
