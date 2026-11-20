// Sample the same candidate row fills used during live search. Compare resolver
// versions on both their wave vectors and their complete labelled final boards.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { COLS } from '../../src/core/constants.js';
import { readGravityBoard } from '../../src/core/ai/gravity-search.js';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { recordedSeat } from './recorded-seat.mjs';

async function capture() {
    const packet = await captureGarbage();
    const seen = new Set();
    const boards = [];
    for (const tier of [3, 6, 10]) for (const seed of [1003, 1006, 1011, 1012, 1017, 1030]) {
        const seat = recordedSeat(tier, seed);
        let locks = -1;
        try {
            for (let tick = 0; tick < 15000 && !seat.state.isGameOver && locks < 75; tick++) {
                if (!seat.state.isProcessingPhysics && seat.state.piecesPlaced !== locks) {
                    locks = seat.state.piecesPlaced;
                    if (locks === 12 && seed % 2) seat.queue.enqueue(packet);
                    const { cells, first, top, height } = readGravityBoard(seat.state.boardGrid);
                    for (let y = height - 1; y >= Math.max(top, first); y--) {
                        const gaps = [];
                        for (let x = 0; x < COLS; x++) if (!cells[y * COLS + x]) gaps.push(x);
                        if (!gaps.length || gaps.length > 4) continue;
                        const sample = cells.slice();
                        for (const x of gaps) sample[y * COLS + x] = cells.length + x + 8;
                        const id = createHash('sha256').update(new Uint8Array(sample.buffer)).digest('hex');
                        if (seen.has(id)) continue;
                        seen.add(id);
                        boards.push([first, top, Array.from(sample)]);
                    }
                }
                seat.step();
            }
        } finally { seat.close(); }
    }
    return boards;
}

async function compare(input, paths) {
    const methods = await Promise.all(paths.map(async path => {
        const module = await import(pathToFileURL(resolve(path)));
        return { path, settle: module.settleLabelledBoard, times: [] };
    }));
    if (methods.length < 2) throw Error('Supply at least two resolver modules');
    const boards = JSON.parse(readFileSync(input, 'utf8')).map(([first, top, cells]) => [first, top, Int32Array.from(cells)]);
    const digest = createHash('sha256');
    const depths = {};
    for (const [first, top, source] of boards) {
        let expected;
        for (const { path, settle } of methods) {
            const copy = source.slice();
            const waves = settle(copy, first, top);
            const result = JSON.stringify([waves, Array.from(copy)]);
            if (expected === undefined) {
                expected = result;
                depths[waves.length] = (depths[waves.length] || 0) + 1;
                digest.update(result);
            } else if (result !== expected) throw Error(path + ' changed a settled board');
        }
    }
    function batch(settle) {
        const scratch = new Int32Array(boards[0][2].length);
        let waves = 0;
        for (let repeat = 0; repeat < 8; repeat++) for (const [first, top, source] of boards) {
            scratch.set(source);
            waves += settle(scratch, first, top).length;
        }
        return waves;
    }
    for (const method of methods) batch(method.settle);
    for (let pass = 0; pass < 8; pass++) for (let i = 0; i < methods.length; i++) {
        const method = methods[(i + pass) % methods.length];
        const cpu = process.cpuUsage();
        const start = performance.now();
        const n = batch(method.settle);
        const elapsed = performance.now() - start;
        const used = process.cpuUsage(cpu);
        method.times.push({ elapsed, cpu: (used.user + used.system) / 1000, n });
    }
    return { boards: boards.length, depths, digest: digest.digest('hex'), methods };
}

const [mode, input, output, ...paths] = process.argv.slice(2);
if (mode === 'capture') {
    writeFileSync(input, JSON.stringify(await capture()), { flag: 'wx' });
} else if (mode === 'compare') {
    writeFileSync(output, JSON.stringify(await compare(input, paths)), { flag: 'wx' });
} else throw Error('Use capture <boards> or compare <boards> <output> <resolver paths>');
