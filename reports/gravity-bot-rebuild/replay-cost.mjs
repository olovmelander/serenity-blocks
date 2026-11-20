// Replay the fixed ticks around over-frame planner calls in a rendered expert
// FFA. Verify the real input tape and labelled scoreboards before reporting
// isolated costs. The event's display frame can contain several simulation ticks.
import { cpus } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { localBotRoundSeed } from '../../src/core/ai/local-bot-manager.js';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';

const [input, output, repetitions = '20', mode = 'spikes'] = process.argv.slice(2);
const capture = JSON.parse(readFileSync(input, 'utf8'));
const passes = Number(repetitions);
const botCount = capture.botCount ?? capture.boards;
if (!Number.isInteger(passes) || passes < 1 || ![1,3,4].includes(botCount)
    || capture.replay || capture.localTiers || capture.checkFormat !== 'body-v1') {
    throw Error('Expected a labelled live expert room and a positive repetition count');
}
const fullFrames = mode === 'frames';
if (!['frames','spikes'].includes(mode) || (fullFrames && !Array.isArray(capture.planningTickFrames))) {
    throw Error('The frames comparison needs a recording with a planning schedule');
}
console.log = () => {};
console.debug = () => {};

// The first single-seat recording timestamped idle callbacks on the session
// clock. Two successive board ticks on either side of a display frame identify
// its round tick exactly. Every such bracket must recover the same offset.
const offsets = new Map();
if (capture.idleSchedule?.length && capture.idleScheduleClock !== 'round') {
    for (const round of new Set(capture.idleSchedule.map(([r]) => r))) {
        const ticks = capture.planningTickFrames.filter(([r]) => r === round);
        const candidates = new Set();
        let next = 0;
        for (const [r, t, , , , frame] of capture.idleSchedule) {
            if (r !== round) continue;
            while (next < ticks.length && ticks[next][2] < frame) next++;
            if (next > 0 && next < ticks.length && ticks[next][2] > frame && ticks[next][1] === ticks[next-1][1] + 1) {
                candidates.add(t - ticks[next-1][1]);
            }
        }
        if (candidates.size !== 1) throw Error('Ambiguous session-to-round clock in round ' + round);
        offsets.set(round, [...candidates][0]);
    }
}
const idleSchedule = (capture.idleSchedule || []).map(([r, t, ...rest]) => [r, t - (offsets.get(r) || 0), ...rest]);

function checkpoint(state, pending) {
    const bodies = new Map();
    const labels = state.boardGrid.map(row => row.map(cell => {
        if (!cell) return '.';
        if (!bodies.has(cell.id)) bodies.set(cell.id, String.fromCharCode(65 + bodies.size));
        return bodies.get(cell.id);
    }).join('')).join('/');
    const types = state.boardGrid.map(row => row.map(cell => cell?.type || '.').join('')).join('/');
    return [state.score, state.piecesPlaced, types, labels, pending];
}

async function replayRound(round, targets, prepare = true) {
    const recordedInputs = capture.inputs.filter(([r]) => r === round);
    const recordedChecks = capture.checks.filter(([r]) => r === round);
    const frames = new Map((capture.planningTickFrames || []).filter(([r]) => r === round).map(([,t,f]) => [t,f]));
    const end = fullFrames
        ? Math.max(0, ...recordedInputs.map(c => c[2]), ...recordedChecks.map(c => c[1]), ...frames.keys(),
            ...idleSchedule.filter(([r]) => r === round).map(c => c[1]))
        : Math.max(...targets.map(event => event.tick)) + 6;
    const inputs = [], checks = [], calls = [];
    const costs = new Map();
    const addCost = (frame, ms) => costs.set(frame, (costs.get(frame) || 0) + ms);
    const idle = new Map();
    for (const [r, t, elapsed, tickMs, advanced, frame] of idleSchedule) {
        if (!prepare || r !== round || t > end) continue;
        if (!idle.has(t)) idle.set(t, []);
        idle.get(t).push({ elapsed, tickMs, advanced, frame });
    }
    const afterFixedTick = (manager, t) => {
        for (const { elapsed, tickMs, advanced, frame } of idle.get(t) || []) {
            const start = process.hrtime.bigint();
            const actual = manager.precomputeFixedSearch(elapsed, tickMs);
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            if (actual !== advanced) throw Error(`Different between-tick work in round ${round} at tick ${t}`);
            if (fullFrames) addCost(frame, ms);
            else if (targets.some(event => Math.abs(t - event.tick) <= 6)) {
                calls.push({ tick: t, frame, origin: 'between-ticks', batches: advanced, ms });
            }
        }
    };
    let tick = 0;
    const observeManager = manager => {
        const advance = manager.advanceFixedInput.bind(manager);
        manager.advanceFixedInput = (slot, context) => {
            tick = context.tick;
            const result = advance(slot, { ...context, emit: command => {
                inputs.push([round, slot, tick, command]);
                return context.emit(command);
            } });
            if (slot === 0 && tick % 300 === 0) {
                const match = manager.multiplayerState;
                checks.push([round, tick, ...match.players.map((state, i) =>
                    checkpoint(state, match.getGarbageQueue(i).getTotalLines()))]);
            }
            return result;
        };
    };
    const configure = bot => {
        if (!prepare) bot.precomputeBetweenTicks = false;
        const step = bot.stepSlicedPlan.bind(bot);
        bot.stepSlicedPlan = (...args) => {
            if (!fullFrames && !targets.some(event => Math.abs(tick - event.tick) <= 6)) return step(...args);
            const start = process.hrtime.bigint();
            try { return step(...args); } finally {
                const ms = Number(process.hrtime.bigint() - start) / 1e6;
                if (fullFrames) {
                    if (!frames.has(tick)) throw Error(`Unexpected planner call in round ${round} at tick ${tick}`);
                    addCost(frames.get(tick), ms);
                } else calls.push({ slot: bot.playerIndex, tick, locks: bot.playerState.piecesPlaced,
                    pending: bot.getPendingGarbage(), ms });
            }
        };
    };
    const game = await duel(9, localBotRoundSeed(83101, round), false, end / 60, {
        fixed: true, live: true, finishFfaRound: true, tiers: Array(capture.boards).fill(10),
        botCount, seriesSeed: 83101, configure, observeManager, afterFixedTick,
    });
    const expectedInputs = recordedInputs.filter(([,,t]) => t <= game.ticksPlayed);
    const expectedChecks = recordedChecks.filter(([,t]) => t <= game.ticksPlayed);
    if (!isDeepStrictEqual(inputs, expectedInputs) || !isDeepStrictEqual(checks, expectedChecks)) {
        throw Error('Replayed commands or labelled board differ in round ' + round);
    }
    return { round, ticks: game.ticksPlayed, matchedInputs: inputs.length, matchedChecks: checks.length,
        ...(fullFrames ? { costs } : { calls }) };
}

const rounds = [];
if (fullFrames) {
    const roundIds = [...new Set(capture.planningTickFrames.map(([r]) => r))];
    for (let pass = -1; pass < passes; pass++) {
        for (const prepare of pass % 2 === 0 ? [true,false] : [false,true]) {
            let matchedInputs = 0, matchedChecks = 0;
            const all = new Map(), start = process.cpuUsage();
            for (const round of roundIds) {
                const sample = await replayRound(round, [], prepare);
                matchedInputs += sample.matchedInputs;
                matchedChecks += sample.matchedChecks;
                for (const [f, ms] of sample.costs) all.set(f, (all.get(f) || 0) + ms);
            }
            const cpu = process.cpuUsage(start);
            const costs = [...all.values()].sort((a,b) => a-b);
            const q = p => costs[Math.ceil(costs.length * p) - 1];
            rounds.push({ pass, prepare, matchedInputs, matchedChecks, activeFrames: costs.length,
                cpuMs: (cpu.user + cpu.system) / 1000, planningMs: costs.reduce((a,b) => a+b,0),
                p95: q(.95), p99: q(.99), maximum: q(1), overFrame: costs.filter(ms => ms > 1000/capture.requestedHz).length });
        }
    }
} else {
    for (const round of new Set(capture.overBudget.map(event => event.round))) {
        const targets = capture.overBudget.filter(event => event.round === round);
        for (let pass = 0; pass < passes; pass++) rounds.push({ pass, ...await replayRound(round, targets) });
    }
}
writeFileSync(output, JSON.stringify({ manifest: capture.buildManifestSha256, requestedHz: capture.requestedHz, mode,
    recoveredRoundClockOffsets: Object.fromEntries(offsets),
    runtime: { v8: process.versions.v8, node: process.versions.node, electron: process.versions.electron, cpu: cpus()[0].model },
    events: capture.overBudget, rounds }), { flag: 'wx' });
