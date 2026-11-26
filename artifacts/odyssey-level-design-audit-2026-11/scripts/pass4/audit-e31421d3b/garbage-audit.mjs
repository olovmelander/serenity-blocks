// Pass 4: does garbage behave by its own rules in an Odyssey duel, for the player's well and the rival's?
// Usage: node garbage-audit.mjs <orbs e.g. 5,26,60> <seeds e.g. 12001+3> [out.json]
// Plays the shipped rivals (live) against three of the benchmark's players and checks every attack and every
// arrival of rows against the rules written in garbage.js and ADR-0024's notes on Odyssey.
import { writeFileSync } from 'node:fs';
import { runAttempt } from '../../../../scripts/odyssey-benchmark/runtime.mjs';
import { applyGarbage, spawnPiece } from '../../../../src/core/game.js';
import { COLS, HIDDEN_ROWS } from '../../../../src/core/constants.js';

const [orbArg, seedArg, outFile] = process.argv.slice(2);
const [start, count] = seedArg.split('+').map(Number);
const CELLS = [['stacker', 'human-regular'], ['cascade', 'human-strong'], ['expert', 'native']];
const log = console.log;
console.log = () => {};
console.debug = () => {};

const total = {
    matches: 0,
    attacks: [0, 0],
    rowsQueued: [0, 0],
    arrivals: [0, 0],
    rowsInserted: [0, 0],
    rowsRefused: [0, 0],
    rowsDroppedAtRoundEnd: [0, 0],
    rowsQueuedAfterAKnockout: [0, 0],
    sankIntoHoles: [0, 0],
    settleClears: [0, 0],
    holesPerRow: {},
    burstSizes: {},
    linesPerAttack: {},
    violations: [],
    firstEntry: null,
};
const bump = (map, key) => { map[key] = (map[key] || 0) + 1; };
const cellsIn = (grid) => grid.reduce((n, row) => n + row.filter(Boolean).length, 0);
const topRow = (grid) => { const y = grid.findIndex((row) => row.some(Boolean)); return y < 0 ? grid.length : y; };
const bitsSet = (mask) => { let n = 0; for (let m = mask >>> 0; m; m >>>= 1) n += m & 1; return n; };

function audit(duel, where) {
    const match = duel.multiplayer;
    const fail = (rule, detail) => total.violations.push({ ...where, round: duel.round, rule, ...detail });
    let inApply = false;
    const waiting = (i) => match.garbageQueues[i].getTotalLines();
    const queuedThisRound = [0, 0];
    const arrivedThisRound = [0, 0];

    // A. Every attack: rows by the formula, to the other well only.
    const route = match.handleGarbageSummary.bind(match);
    match.handleGarbageSummary = (index, summary, callback) => {
        if (inApply) fail('a settle clear sent an attack', { index });
        const before = [waiting(0), waiting(1)];
        const result = route(index, summary, callback);
        const lines = summary.depth ?? summary.totalLines ?? 0;
        const expected = (lines >= 2 ? lines - 1 : 0) + (summary.sendForPerfectClear ? Math.floor((1 + lines) / 2) : 0);
        const other = 1 - index;
        const got = waiting(other) - before[other];
        if (got !== expected) fail('attack size', { index, lines, perfect: !!summary.sendForPerfectClear, expected, got });
        if (waiting(index) !== before[index]) fail('an attack changed the sender\'s own queue', { index });
        if (expected > 0) {
            total.attacks[index]++;
            total.rowsQueued[other] += expected;
            // A clear still resolving when a well has already ended sends its rows into a round that is over.
            if (duel.pendingDeaths.size > 0 || duel.transition || !duel.roundActive) total.rowsQueuedAfterAKnockout[other] += expected;
            else queuedThisRound[other] += expected;
            bump(total.linesPerAttack, lines);
            if (match.lastAttackerIds[other] !== index) fail('the attacker was not noted for the knockout', { index });
        }
        return result;
    };

    // B. Every arrival: the match's own _spawnWithGarbage, restated so the insertion can be inspected.
    duel._spawnWithGarbage = (index) => {
        const state = duel.players[index];
        if (state.isGameOver) return;
        const queue = match.garbageQueues[index];
        const entries = [];
        let burst = queue.dequeueLineBurst();
        while (burst.length) {
            bump(total.burstSizes, burst.length);
            entries.push(...burst);
            burst = queue.dequeueLineBurst();
        }
        if (entries.length) {
            total.firstEntry ??= Object.fromEntries(Object.entries(entries[0]).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : v]));
            if (waiting(index) !== 0) fail('rows were left waiting at a spawn', { index, left: waiting(index) });
            const grid = state.boardGrid;
            const before = { cells: cellsIn(grid), top: topRow(grid), score: state.score, lines: state.lines, total: state.totalLinesCleared };
            inApply = true;
            const result = applyGarbage(state, entries);
            inApply = false;
            const after = { cells: cellsIn(state.boardGrid), top: topRow(state.boardGrid) };
            const wouldOverflow = before.top - entries.length < HIDDEN_ROWS;
            total.arrivals[index]++;
            if (result?.topOut) {
                total.rowsRefused[index] += entries.length;
                arrivedThisRound[index] += entries.length;
                if (!wouldOverflow) fail('rows were refused although they fitted', { index, top: before.top, rows: entries.length });
                if (after.cells !== before.cells) fail('a refused burst changed the well', { index });
                duel.markTopOut(index);
                return;
            }
            total.rowsInserted[index] += entries.length;
            arrivedThisRound[index] += entries.length;
            if (wouldOverflow) fail('rows that overflow the visible well were inserted', { index, top: before.top, rows: entries.length });
            let added = 0;
            for (const entry of entries) {
                const holes = bitsSet(entry.holeMask ?? entry.mask ?? 0);
                bump(total.holesPerRow, holes);
                if (holes < 1 || holes >= COLS) fail('a row with no hole or no block', { index, holes });
                added += COLS - holes;
            }
            const cleared = result?.settleClearedRows?.length || 0;
            total.settleClears[index] += cleared;
            if (after.cells !== before.cells + added - COLS * cleared) {
                fail('cells after an arrival do not add up', { index, before: before.cells, added, cleared, after: after.cells });
            }
            // The stack rises by the rows that arrive, less whatever settles into their holes.
            if (!cleared && after.top !== before.top - entries.length) {
                if (after.top > before.top - entries.length && after.top <= before.top) total.sankIntoHoles[index]++;
                else fail('the stack rose more than the rows that arrived', { index, before: before.top, rows: entries.length, after: after.top });
            }
            if (state.score !== before.score || state.lines !== before.lines || state.totalLinesCleared !== before.total) {
                fail('a settle clear was credited', { index, cleared });
            }
            duel._callVisual(index, 'onGarbageApplied', entries.length);
        }
        spawnPiece(state, index === 0 ? duel.onPieceSpawn : null, () => duel.markTopOut(index));
    };

    // C. Rows still waiting when a round ends are dropped, for both wells, and the books balance.
    const barrier = duel._beginRoundBarrier.bind(duel);
    duel._beginRoundBarrier = () => {
        if (!duel.transition) {
            for (const i of [0, 1]) {
                const left = waiting(i);
                total.rowsDroppedAtRoundEnd[i] += left;
                if (queuedThisRound[i] !== arrivedThisRound[i] + left) {
                    fail('rows queued in a round do not equal rows arrived plus rows left', { index: i, queued: queuedThisRound[i], arrived: arrivedThisRound[i], left });
                }
                queuedThisRound[i] = 0;
                arrivedThisRound[i] = 0;
            }
        }
        barrier();
    };
    const next = duel._startNextRound.bind(duel);
    duel._startNextRound = (time) => {
        next(time);
        for (const i of [0, 1]) if (waiting(i) !== 0) fail('rows carried into a new round', { index: i, left: waiting(i) });
    };
}

for (const orb of orbArg.split(',').map(Number)) {
    for (let seed = start; seed < start + count; seed++) {
        for (const [profile, cadence] of CELLS) {
            const where = { orb, seed, profile, cadence };
            const attempt = await runAttempt({
                levelId: orb, seed, profile, cadenceId: cadence, liveRival: true, wallBudgetMs: 3600000,
                maxSimSeconds: 1800, maxPieces: 3000, configureRival: (duel) => audit(duel, where),
            });
            if (attempt.outcome === 'error') total.violations.push({ ...where, rule: 'the match errored', reason: attempt.reason });
            total.matches++;
        }
    }
}
const summary = { ...total, violations: total.violations.length, examples: total.violations.slice(0, 12) };
if (outFile) writeFileSync(outFile, JSON.stringify({ ...total }, null, 1));
log(JSON.stringify(summary, null, 1));
