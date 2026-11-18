// Standard two-board, first top-out. Use the real local manager, input scheduler,
// gravity, attack router, spawn-boundary insertion and fixed virtual animation clock.
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MultiPlayerState } from '../../src/core/multi-player-state.js';
import { LocalBotManager } from '../../src/core/ai/local-bot-manager.js';
import { applyGarbage, fillBag, processAutoDrop } from '../../src/core/game.js';
import { bindLegacySessionRng } from '../../src/core/session-rng.js';
import { applyFixedLineImpactHitStop } from '../../src/core/fixed-hit-stop-policy.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { createVirtualClock } from '../../scripts/odyssey-benchmark/virtual-clock.mjs';
import { controls, spawn } from './solo.mjs';

export async function duel(low, seed, swap, seconds = 150, options = {}) {
    if (!Number.isInteger(low) || low < 1 || low > 9) throw new RangeError('Expected the lower tier 1 through 9');
    const clock = createVirtualClock().install();
    const mp = new MultiPlayerState(2);
    if (options.live) mp.sharedPieceSeed = seed;
    const tiers = swap ? [low + 1, low] : [low, low + 1];
    const frame = 1000 / 60;
    // For a pressure decision, count the queue when the planner runs.
    const stats = tiers.map(() => ({ locks: 0, plans: 0, queuedPlans: 0, queueSeen: 0, dangerQueued: 0,
        firedQueued: 0, incoming: 0, applied: 0, pendingOnLoss: 0, dugLocks: 0, dugCells: 0, sent: 0 }));
    const garbageCells = state => state.boardGrid.reduce((n, row) =>
        n + row.filter((c) => c?.type === 'GARBAGE' || c?.type === 'CLEAN_GARBAGE').length, 0);
    let manager;
    try {
        const callbacks = mp.players.map((state, i) => {
            let beforeLock;
            state.disableLevelProgression = true;
            bindLegacySessionRng(state, seed);
            fillBag(state.nextPieces, state.randomGenerator);
            spawn(state);
            return {
                onHardDrop: () => { state.hitStopRemaining = Math.max(state.hitStopRemaining || 0, 30); },
                // The normal-motion local presentation applies the same 70 ms on a four-row wave.
                onLineClearImpact: lines => applyFixedLineImpactHitStop(state, lines),
                onPieceLock: () => { stats[i].locks++; beforeLock = garbageCells(state); },
                onGarbageReady: (summary) => mp.handleGarbageSummary(i, summary),
                spawnPiece: () => {
                    const after = garbageCells(state);
                    if (beforeLock > after) {
                        stats[i].dugLocks++;
                        stats[i].dugCells += beforeLock - after;
                    }
                    const queue = mp.getGarbageQueue(i);
                    const entries = [];
                    for (let burst = queue.dequeueLineBurst(); burst.length; burst = queue.dequeueLineBurst()) entries.push(...burst);
                    if (entries.length) {
                        stats[i].incoming += entries.length;
                        const result = applyGarbage(state, entries);
                        if (result.topOut) { state.isGameOver = true; return; }
                        stats[i].applied += entries.length;
                    }
                    spawn(state);
                },
            };
        });
        mp.onAttack = (from, _to, lines) => { stats[from].sent += lines; };
        manager = new LocalBotManager({ multiplayerState: mp,
            actionFactory: i => controls(mp.players[i], callbacks[i]), rng: seededRandom((seed ^ 0x85ebca6b) >>> 0) });
        manager.configure(tiers.map(difficulty => ({ kind: 'bot', difficulty })));
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
        const rounds = Math.round(seconds * 60);
        for (let tick = 0; tick < rounds && !mp.players.some((s) => s.isGameOver); tick++) {
            await clock.advance(frame);
            manager.update(frame, clock.now);
            for (let i = 0; i < 2; i++) {
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
        const winner = lost[0] === lost[1] ? null : tiers[lost[0] ? 1 : 0];
        mp.players.forEach((s, i) => { stats[i].pendingOnLoss = s.isGameOver ? mp.getGarbageQueue(i).getTotalLines() : 0; });
        return { low, seed, swap, tiers, winner, simultaneous: lost.every(Boolean), seconds: Math.round(clock.now / 1000), stats };
    } finally {
        manager?.destroy();
        // Retire the players before draining any opponent animation still in progress.
        for (const state of mp.players) state.isStopped = true;
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
