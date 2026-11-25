// Last Standing rooms of live bots (Infinity boards, out at the roof), measured lock by lock.
// node infinity-rooms.mjs <out.jsonl> <first seed> <count> <seconds> <well rows> <tiers> [seat overrides JSON]
// An override {"1":{"versusWeights":null}} plays that seat with the older Infinity planner.
import { appendFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import { heights, readBoard, shafts } from './board-measures.mjs';

const [out, first, count, seconds, well, room, changes = '{}'] = process.argv.slice(2);
const tiers = room.split(',').map(Number);
const overrides = JSON.parse(changes);
console.debug = () => {};
const say = console.log;
console.log = () => {};
writeFileSync(out, '', { flag: 'wx' });

for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
    const seats = tiers.map(() => ({ locks: 0, lines: 0, sent: 0, singles: 0, rowsIn: 0, fires: [], big: 0, bigEdge: 0, bigParked: 0, top: 0, refused: 0 }));
    const frames = [];
    const open = tiers.map(() => null);
    const result = await duel(Math.max(1, Math.min(9, tiers[0])), seed, false, Number(seconds), {
        tiers, live: true, useLocalStyles: true, infinity: Number(well),
        configure: (bot) => {
            const change = overrides[bot.playerIndex];
            if (Object.keys(overrides).length) bot.sharedSearch = null;
            if (change && 'versusWeights' in change) bot.versusWeights = change.versusWeights;
            const perform = bot.scheduler.perform.bind(bot.scheduler);
            bot.scheduler.perform = (action) => { const done = perform(action); if (!done) seats[bot.playerIndex].refused++; return done; };
        },
        observeManager: (manager) => {
            const update = manager.update.bind(manager);
            manager.update = (...args) => { const t = performance.now(); try { return update(...args); } finally { frames.push(performance.now() - t); } };
        },
        observe: {
            lock(i, piece, state) {
                seats[i].locks++;
                open[i] = shafts(readBoard(state.boardGrid))[0] ?? null;
            },
            summary(i, summary) {
                const s = seats[i];
                const n = summary.totalLines ?? summary.depth ?? 0;
                s.lines += n;
                s.sent += Math.max(0, n - 1);
                if (summary.source === 'garbage-settle') return;
                if (n === 1) s.singles++;
                if (n < 2) return;
                s.fires.push(n);
                if (n < 5) return;
                s.big++;
                const shaft = open[i];
                const edge = shaft?.roofed && (shaft.col === 0 || shaft.col === 9);
                s.bigEdge += Number(Boolean(edge));
                s.bigParked += Number(Boolean(edge && shaft.straights >= 1));
            },
            rows(i, taken) { seats[i].rowsIn += taken.rows; },
            death(i, state) { seats[i].top = Math.max(...heights(readBoard(state.boardGrid))); },
        },
    });
    const played = result.ticksPlayed / 60;
    frames.sort((a, b) => a - b);
    const plan = { mean: frames.reduce((t, x) => t + x, 0) / Math.max(1, frames.length), p99: frames[Math.floor(frames.length * 0.99)] ?? 0, max: frames.at(-1) ?? 0 };
    const row = { seed, tiers, well: Number(well), seconds: played, plan, survivor: result.survivor, out: result.out, lost: result.lost,
        ...(changes !== '{}' && { overrides }), seats };
    appendFileSync(out, `${JSON.stringify(row)}\n`);
    const mean = (xs) => (xs.length ? (xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(2) : '-');
    say(seed, room, `${played.toFixed(0)} s`, 'survivor', result.survivor, 'out', JSON.stringify(result.out.map(([i, t]) => [i, Math.round(t / 60)])),
        'pieces/min', seats.map((s, i) => { const end = result.out.find(([j]) => j === i)?.[1] ?? result.ticksPlayed; return (s.locks / (end / 3600)).toFixed(0); }).join(' '),
        'sent/piece', seats.map((s) => (s.sent / Math.max(1, s.locks)).toFixed(2)).join(' '), 'fire', seats.map((s) => mean(s.fires)).join(' '),
        'edge', seats.map((s) => `${s.bigEdge}/${s.big}`).join(' '), 'refused', seats.map((s) => s.refused).join(' '),
        'plan ms', `${plan.mean.toFixed(2)}/${plan.p99.toFixed(1)}/${plan.max.toFixed(0)}`);
}
process.exit(0);
