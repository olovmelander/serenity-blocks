// Replay the fixed ticks around over-frame planner calls in a rendered expert
// FFA. Verify the real input tape and labelled scoreboards before reporting
// isolated costs. The event's display frame can contain several simulation ticks.
import { cpus } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { localBotRoundSeed } from '../../src/core/ai/local-bot-manager.js';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';

const [input, output, repetitions = '20'] = process.argv.slice(2);
const capture = JSON.parse(readFileSync(input, 'utf8'));
const passes = Number(repetitions);
if (!Number.isInteger(passes) || passes < 1 || ![3,4].includes(capture.boards)
    || capture.replay || capture.localTiers || capture.checkFormat !== 'body-v1') {
    throw Error('Expected a labelled live three- or four-expert recording and a positive repetition count');
}
console.log = () => {};
console.debug = () => {};

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

async function replayRound(round, targets) {
    const end = Math.max(...targets.map(event => event.tick)) + 6;
    const inputs = [], checks = [], calls = [];
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
        const step = bot.stepSlicedPlan.bind(bot);
        bot.stepSlicedPlan = (...args) => {
            if (!targets.some(event => Math.abs(tick - event.tick) <= 6)) return step(...args);
            const start = process.hrtime.bigint();
            try { return step(...args); } finally {
                const ms = Number(process.hrtime.bigint() - start) / 1e6;
                calls.push({ slot: bot.playerIndex, tick, locks: bot.playerState.piecesPlaced,
                    pending: bot.getPendingGarbage(), ms });
            }
        };
    };
    const game = await duel(9, localBotRoundSeed(83101, round), false, end / 60, {
        fixed: true, live: true, finishFfaRound: true, tiers: Array(capture.boards).fill(10),
        seriesSeed: 83101, configure, observeManager,
    });
    const expectedInputs = capture.inputs.filter(([r,,t]) => r === round && t <= game.ticksPlayed);
    const expectedChecks = capture.checks.filter(([r,t]) => r === round && t <= game.ticksPlayed);
    if (!isDeepStrictEqual(inputs, expectedInputs) || !isDeepStrictEqual(checks, expectedChecks)) {
        throw Error('Replayed commands or labelled board differ in round ' + round);
    }
    return { round, ticks: game.ticksPlayed, matchedInputs: inputs.length, matchedChecks: checks.length, calls };
}

const rounds = [];
for (const round of new Set(capture.overBudget.map(event => event.round))) {
    const targets = capture.overBudget.filter(event => event.round === round);
    for (let pass = 0; pass < passes; pass++) rounds.push({ pass, ...await replayRound(round, targets) });
}
writeFileSync(output, JSON.stringify({ manifest: capture.buildManifestSha256, requestedHz: capture.requestedHz,
    runtime: { v8: process.versions.v8, node: process.versions.node, electron: process.versions.electron, cpu: cpus()[0].model },
    events: capture.overBudget, rounds }), { flag: 'wx' });

