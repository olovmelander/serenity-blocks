// Report a native local seat's actual commands and locks, including elapsed-time
// lock bonuses, the fixed simulation clock and the ordinary per-spawn reaction.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { calculateGarbage } from '../../src/core/garbage.js';
import { betweenTickFrames, recordedSeat } from './recorded-seat.mjs';
import { pose } from '../bot-ai-audit-2026-11/solo.mjs';

export function liveOpening(seed, limit = 16, trace = false, control = false, tier = 10, configure, useLocalStyles = true, hz = 60) {
    const showBoards = trace === true;
    const track = [], labels = new Map();
    let latest, attack = 0, rejected = 0;
    const grid = () => {
        const rows = state.boardGrid.map(row => row.map(cell => {
            if (!cell) return '.';
            if (!labels.has(cell.id)) labels.set(cell.id, String.fromCharCode(65 + labels.size % 26));
            return labels.get(cell.id);
        }).join(''));
        const top = rows.findIndex(row => /[^.]/.test(row));
        return top < 0 ? [] : rows.slice(top);
    };
    let inputs = [];
    const seat = recordedSeat(tier, seed, piece => {
        const expected = [];
        const planned = bot.lastPlan?.candidate;
        // Automatic gravity can lock an intermediate pose while an input is
        // pending. Only the build that actually landed can earn a forecast.
        for (let f = planned && pose(planned) === pose(piece) ? planned.futurePlan : null; f?.candidate; f = f.child) {
            expected.push({ pose: pose(f.candidate), waves: f.candidate.cascadeCount,
                rows: f.candidate.waves?.map(wave => wave.lineCount ?? wave) });
        }
        latest = { lock: track.length + 1, tick: state.simFrame, shape: piece.shapeKey,
            x: piece.x, y: piece.y, rotation: piece.rotation, expected, inputs, waves: [], waveBoards: [] };
        inputs = [];
        track.push(latest);
    }, {
        control, useLocalStyles,
        onLineClear: rows => { latest.waves.push(rows); if (showBoards) latest.waveBoards.push(grid()); },
        onGarbageReady: summary => { attack += calculateGarbage(summary).getTotalLines(); },
    });
    const { state, bot } = seat;
    configure?.(bot);
    try {
        for (let tick = 0; tick < Math.max(36000, limit * 600) && !state.isGameOver; tick++) {
            const inputForPiece = inputs;
            const result = seat.step();
            if (hz > 60 && !control) betweenTickFrames(hz, result.tick, seat.precompute);
            for (const { command, disposition } of result.input) {
                rejected += Number(disposition !== 'applied');
                if (showBoards) inputForPiece.push({ type: command.action, dir: command.value ?? undefined, tick: result.tick, disposition });
            }
            if (latest && !state.isProcessingPhysics && latest.score === undefined) {
                latest.score = state.score; latest.attack = attack;
                if (showBoards) latest.rows = grid();
            }
            if (track.length === limit && !state.isProcessingPhysics) break;
        }
        if (!state.isGameOver && track.length !== limit) throw Error('Incomplete scheduled run on seed ' + seed);
        const row = { seed, tier, locks: track.length, fires: track.filter(lock => lock.waves.length)
            .map(lock => [lock.lock, ...lock.waves]), attack, score: state.score, rejected, topOut: state.isGameOver };
        if (trace) row.track = track;
        return row;
    } finally { seat.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [cohort, out, limit = '16', policy, hz = '60'] = process.argv.slice(2);
    const seeds = cohort.includes('+') ? Array.from({ length: +cohort.split('+')[1] }, (_, i) => +cohort.split('+')[0] + i)
        : readFileSync(cohort, 'utf8').trim().split(/\s+/).map(Number);
    writeFileSync(out, '', { flag: 'wx' });
    for (const seed of seeds) appendFileSync(out, JSON.stringify(
        liveOpening(seed, +limit, false, policy === 'control', 10, undefined, true, Number(hz))) + '\n');
}
