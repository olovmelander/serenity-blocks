// Free-for-all rooms of live bots, measured lock by lock in the playbook's terms.
// node record.mjs <out.jsonl> <first seed> <count> <seconds> <frag target> <tiers, e.g. 10,10> [rules] [match config JSON] [seat overrides JSON]
import { appendFileSync, writeFileSync } from 'node:fs';
import { HIDDEN_ROWS } from '../../src/core/constants.js';
import { computeProjectedAttack } from '../../src/core/ai/cascade-simulator.js';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import {
    bestClear, covered, garbageRows, heights, readBoard, shafts,
} from './board-measures.mjs';

const [out, first, count, seconds, target, room, rules = 'shipped', config = '{}', changes = '{}'] = process.argv.slice(2);
const matchConfig = JSON.parse(config);
// {"0": {"weights": {...}, "search": {...}, "units": 4}}: experiments on one seat, without touching the game.
const overrides = JSON.parse(changes);
const tiers = room.split(',').map(Number);
console.debug = () => {};
writeFileSync(out, '', { flag: 'wx' });

const mean = (xs) => xs.reduce((t, x) => t + x, 0) / xs.length;

for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
    const seats = tiers.map(() => ({
        locks: 0, lines: 0, settleLines: 0, sent: 0, clean: 0, singles: 0, rowsIn: 0, sinceFire: 0, fires: [], offers: {},
        reaction: [], deaths: [], finishing: { plans: 0, killed: 0 }, panic: { plans: 0, died: 0 }, rejected: {}, inputs: 0, tucks: 0,
        droppedAtCap: 0, droppedAtDeath: 0, boards: { n: 0, max: 0, over20: 0, roofed3: 0, parked: 0, parked2: 0, heights: Array(10).fill(0) },
    }));
    const open = tiers.map(() => null);
    const closeOffer = (i) => {
        const o = open[i];
        if (o?.offer) {
            const a = seats[i].offers[Math.min(8, o.offer)] ??= [0, 0, 0, 0];
            a[0]++;
            a[1] += Number(o.lines === o.offer);
            a[2] += Number(o.lines >= 2);
            a[3] += Number(o.lines === 0);
        }
        open[i] = null;
    };
    // Decisions taken on the old death rule: a shot meant to finish somebody, an escape from rows
    // that would have lifted a column past the top. Each is judged by what then happened.
    let match = null;
    let tick = 0;
    const shots = [];
    const escapes = tiers.map(() => null);
    const watch = (bot) => {
        const i = bot.playerIndex;
        if (Object.keys(overrides).length) bot.sharedSearch = null;
        const change = overrides[i];
        if (change?.weights) bot.weights = { ...bot.weights, ...change.weights };
        if (change?.search) Object.assign(bot.searchConfig, change.search);
        if (change?.units) bot.planUnitsPerMs *= change.units;
        const perform = bot.scheduler.perform.bind(bot.scheduler);
        bot.scheduler.perform = (action) => {
            const done = perform(action);
            seats[i].inputs++;
            if (!done) seats[i].rejected[action.type] = (seats[i].rejected[action.type] ?? 0) + 1;
            return done;
        };
        const adopt = bot.adoptPlan.bind(bot);
        bot.adoptPlan = (plan) => {
            const candidate = plan?.candidate;
            if (candidate) {
                const space = bot.config.tier >= 8 ? bot.finishingRoom?.() : undefined;
                const rowsNeeded = space < bot.searchConfig.safetyMargin ? Math.max(1, space + 1) : Infinity;
                if (computeProjectedAttack(candidate.totalLines, Boolean(candidate.perfectClear)) >= rowsNeeded) {
                    seats[i].finishing.plans++;
                    shots.push({ from: i, to: 1 - i, tick });
                }
                const pending = match.getGarbageQueue(i).getTotalLines();
                const board = readBoard(match.players[i].boardGrid);
                const space2 = board.height - HIDDEN_ROWS - Math.max(...heights(board));
                if (pending && space2 - pending < 0) { seats[i].panic.plans++; escapes[i] = tick; }
            }
            return adopt(plan);
        };
    };
    const judge = (i) => {
        // Somebody died: every finishing shot at them in the last three seconds counts as a kill.
        for (const shot of shots) if (!shot.judged && shot.to === i && tick - shot.tick <= 180) { shot.judged = true; seats[shot.from].finishing.killed++; }
        if (escapes[i] !== null && tick - escapes[i] <= 90) seats[i].panic.died++;
        escapes[i] = null;
    };
    const observe = {
        lock(i, piece, state) {
            const s = seats[i];
            const above = (dy, dx) => { for (let y = piece.y + dy - 1; y >= 0; y--) if (state.boardGrid[y]?.[piece.x + dx]) return true; return false; };
            s.tucks += Number(piece.shape.some((row, dy) => row.some((v, dx) => v && above(dy, dx))));
            const board = readBoard(state.boardGrid);
            const h = heights(board);
            const max = Math.max(...h);
            const shaft = shafts(board)[0] ?? null;
            s.locks++;
            s.sinceFire++;
            s.boards.n++;
            s.boards.max += max;
            s.boards.over20 += Number(max > 20);
            h.forEach((v, x) => { s.boards.heights[x] += v; });
            if (shaft?.roofed && shaft.rows >= 3) {
                s.boards.roofed3++;
                s.boards.parked += Number(shaft.straights >= 1);
                s.boards.parked2 += Number(shaft.straights >= 2);
            }
            open[i] = { key: piece.shapeKey, max, mean: mean(h), covered: covered(board), garbage: garbageRows(board), shaft,
                offer: bestClear(board, piece.shapeKey), lines: 0, waves: 0 };
            if (s.waiting) s.waiting.pieces++;
        },
        summary(i, summary) {
            const s = seats[i];
            const lines = summary.totalLines ?? summary.depth ?? 0;
            s.lines += lines;
            s.sent += Math.max(0, lines - 1);
            if (summary.sendForPerfectClear && lines) { s.clean++; s.sent += Math.floor((1 + lines) / 2); }
            if (summary.source === 'garbage-settle') { s.settleLines += lines; return; }
            if (lines === 1) s.singles++;
            const o = open[i];
            if (!o) return;
            o.lines = lines;
            o.waves = summary.complexity ?? summary.comboStages ?? 0;
            if (lines < 2) return;
            const shaft = o.shaft ? [o.shaft.col, o.shaft.rows, Number(o.shaft.roofed), o.shaft.straights] : null;
            s.fires.push([lines, o.waves, o.max, Math.round(o.mean * 10) / 10, o.covered, o.garbage, s.sinceFire, o.key, shaft]);
            s.sinceFire = 0;
            if (s.waiting) { s.reaction.push([s.waiting.rows, s.waiting.pieces, lines]); s.waiting = null; }
        },
        rows(i, taken) {
            closeOffer(i);
            seats[i].rowsIn += taken.rows;
            if (taken.rows >= 3) seats[i].waiting = { rows: taken.rows, pieces: 0 };
        },
        death(i, state) {
            const s = seats[i];
            judge(i);
            const h = heights(readBoard(state.boardGrid));
            s.deaths.push([Math.max(...h), Math.max(...h.slice(3, 7)), s.sinceFire]);
            s.sinceFire = 0;
            s.waiting = null;
            open[i] = null;
        },
    };
    const r = await duel(Math.max(1, Math.min(9, tiers[0])), seed, false, Number(seconds), {
        tiers, rules, live: true, fixed: true, useLocalStyles: true, fragTarget: Number(target), observe, matchConfig,
        configure: watch,
        observeManager: (manager) => {
            match = manager.multiplayerState;
            match.garbageQueues.forEach((queue, i) => {
                const push = queue._push.bind(queue);
                queue._push = (entry) => { const n = queue.entries.length; push(entry); if (queue.entries.length === n) seats[i].droppedAtCap++; };
                const clear = queue.clear.bind(queue);
                queue.clear = (...args) => { seats[i].droppedAtDeath += queue.getTotalLines(); return clear(...args); };
            });
        },
        afterFixedTick: () => { tick++; },
    });
    const played = r.ticksPlayed / 60;
    appendFileSync(out, JSON.stringify({ seed, tiers, rules, ...(config !== '{}' && { matchConfig }), ...(changes !== '{}' && { overrides }), seconds: played, frags: r.frags ?? null, decided: r.winner !== null, leader: r.leader ?? null,
        lost: r.lost, down: r.stats.map((s) => (s.downTicks ?? 0) / 60), seats: seats.map(({ waiting, sinceFire, ...s }) => s) }) + '\n');
    console.log(seed, room, 'seconds', played.toFixed(0), 'frags', r.frags?.join(' '), 'pieces/min',
        seats.map((s, i) => (s.locks / ((played - (r.stats[i].downTicks ?? 0) / 60) / 60)).toFixed(0)).join(' '), 'sent', seats.map((s) => s.sent).join(' '));
}
