// Draws a live tier 10's build and fire from a seeded room, board by board.
// node replay-fire.mjs <seed> <seconds> [tiers] [pieces to show before the trigger]
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';
import { COLS, HIDDEN_ROWS } from '../../src/core/constants.js';

const [seed = '91001', seconds = '180', room = '10,10', back = '12'] = process.argv.slice(2);
const tiers = room.split(',').map(Number);
console.debug = () => {};
const log = console.log;
console.log = () => {};

const letter = (cell) => (cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE' ? '=' : String(cell.type || '?')[0]);
const copy = (grid) => grid.map((row) => row.map((cell) => (cell ? letter(cell) : '.')));
const stamp = (board, piece, mark) => {
    piece.shape.forEach((row, dy) => row.forEach((v, dx) => { if (v && piece.y + dy >= 0) board[piece.y + dy][piece.x + dx] = mark; }));
    return board;
};
const seats = tiers.map(() => ({ locks: [], fires: [] }));
let tick = 0;
const observe = {
    lock(i, piece, state) {
        seats[i].locks.push({ tick, key: piece.shapeKey, marked: stamp(copy(state.boardGrid), piece, '#'), waves: [], rows: 0, lines: 0, after: null });
    },
    wave(i, lines) { seats[i].locks.at(-1)?.waves.push(Number(lines) || lines?.length || 0); },
    summary(i, summary, state) {
        if (summary.source === 'garbage-settle') return;
        const lock = seats[i].locks.at(-1);
        lock.lines = summary.totalLines ?? summary.depth ?? 0;
        lock.after = copy(state.boardGrid);
    },
    rows(i, taken) { const lock = seats[i].locks.at(-1); if (lock) lock.rows = taken.rows; },
    death(i) { seats[i].locks.push({ tick, dead: true, waves: [], rows: 0, lines: 0 }); },
};
const result = await duel(Math.max(1, Math.min(9, tiers[0])), Number(seed), false, Number(seconds), {
    tiers, rules: 'shipped', live: true, fixed: true, useLocalStyles: true, fragTarget: 50, observe, afterFixedTick: () => { tick++; },
});

const strip = (boards, labels) => {
    const rows = boards[0].length;
    let first = rows;
    for (const b of boards) for (let y = 0; y < rows; y++) if (b[y].some((c) => c !== '.')) { first = Math.min(first, y); break; }
    const out = [labels.map((l) => l.padEnd(14)).join(' ')];
    for (let y = Math.max(0, first - 1); y < rows; y++) out.push(boards.map((b) => `${String(rows - y).padStart(2)} ${b[y].join('')}${y === HIDDEN_ROWS ? '<' : ' '}`).join(' '));
    return out.join('\n');
};
const best = seats.flatMap((s, seat) => s.locks.map((lock, at) => ({ seat, at, lock }))).filter((x) => x.lock.lines >= 5)
    .sort((a, b) => b.lock.lines - a.lock.lines)[0];
log(`Seed ${seed}, ${room}, ${seconds} s: frags ${result.frags?.join('-')}, pieces/min ${seats.map((s) => Math.round(s.locks.length / (result.ticksPlayed / 3600))).join(' ')}`);
for (const [i, s] of seats.entries()) {
    const fires = s.locks.filter((l) => l.lines >= 2);
    log(`seat ${i + 1} (tier ${tiers[i]}): ${s.locks.length} pieces, fires by size: ${Object.entries(fires.reduce((t, l) => { t[l.lines] = (t[l.lines] ?? 0) + 1; return t; }, {})).map(([k, n]) => `${k}x${n}`).join(' ')}`);
}
if (best) {
    const { locks } = seats[best.seat];
    const from = Math.max(0, best.at - Number(back));
    log(`\nLargest fire: seat ${best.seat + 1}, ${(best.lock.tick / 60).toFixed(1)} s, ${best.lock.lines} lines in ${best.lock.waves.length} waves (${best.lock.waves.join('+')}). # is the piece just placed, = a row from an opponent, < the top visible row.\n`);
    const shown = locks.slice(from, best.at + 1).filter((l) => !l.dead);
    for (let k = 0; k < shown.length; k += 5) {
        const part = shown.slice(k, k + 5);
        log(`${strip(part.map((l) => l.marked), part.map((l) => `${locks.indexOf(l) - best.at} ${l.key}${l.lines ? ` clr${l.lines}` : ''}${l.rows ? ` +${l.rows}` : ''}`))}\n`);
    }
    if (best.lock.after) log(strip([best.lock.after], ['after']));
}
process.exit(0);
