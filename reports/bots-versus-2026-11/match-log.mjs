// One seeded free-for-all of live bots to its goal, as a log: every fire, every rise, every death.
// node match-log.mjs <seed> [tiers] [frag goal]
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import { heights, readBoard } from './board-measures.mjs';

const [seed = '91005', room = '10,10', goal = '7'] = process.argv.slice(2);
const tiers = room.split(',').map(Number);
console.debug = () => {};
const log = console.log;
console.log = () => {};
let tick = 0;
let match = null;
const pieces = tiers.map(() => 0);
const sent = tiers.map(() => 0);
const sizes = tiers.map(() => ({}));
const lines = [];
const at = () => { const s = tick / 60; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const tall = (state) => { const h = heights(readBoard(state.boardGrid)); return `${Math.max(...h)}/${Math.max(...h.slice(3, 7))}`; };
const waves = tiers.map(() => []);
const result = await duel(Math.max(1, Math.min(9, tiers[0])), Number(seed), false, 900, {
    tiers, rules: 'shipped', live: true, fixed: true, useLocalStyles: true, fragTarget: Number(goal),
    observeManager: (manager) => { match = manager.multiplayerState; },
    afterFixedTick: () => { tick++; },
    observe: {
        lock(i) { pieces[i]++; waves[i] = []; },
        wave(i, n) { waves[i].push(Number(n) || n?.length || 0); },
        summary(i, summary, state) {
            const n = summary.totalLines ?? summary.depth ?? 0;
            sent[i] += Math.max(0, n - 1);
            if (summary.source === 'garbage-settle') { if (n >= 3) lines.push(`${at()}  P${i + 1} ${n} lines from a rise`); return; }
            if (n >= 2) sizes[i][n] = (sizes[i][n] ?? 0) + 1;
            if (n >= 6) lines.push(`${at()}  P${i + 1} fires ${n} lines (${waves[i].join('+')}), stack after ${tall(state)}`);
        },
        rows(i, taken, state) { if (taken.rows >= 6) lines.push(`${at()}  P${i + 1} takes ${taken.rows} rows, stack ${tall(state)}`); },
        death(i, state) { lines.push(`${at()}  P${i + 1} OUT, stack ${tall(state)}, frags ${match.frags.join('-')}`); },
    },
});
log(`Seed ${seed}, tiers ${tiers.join(' v ')}, free-for-all to ${goal}: ${result.frags.join('-')} in ${at()}. Stacks are tallest column / spawn columns.`);
log(lines.join('\n'));
tiers.forEach((t, i) => log(`P${i + 1} (tier ${t}): ${pieces[i]} pieces, ${(pieces[i] / (tick / 3600)).toFixed(0)} a minute, ${sent[i]} rows sent, fires by size ${Object.entries(sizes[i]).map(([k, n]) => `${k}x${n}`).join(' ')}`));
process.exit(0);
