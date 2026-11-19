// Compare every candidate straight-drop trigger near the roof with the full
// control search on the same occupied board, including symmetric rotations.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { COLS, SHAPES } from '../../src/core/constants.js';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { recordedSeat } from './recorded-seat.mjs';

const [output, probes = new URL('./roof-trigger-boards.json', import.meta.url)] = process.argv.slice(2);
if (!output) throw Error('Supply an output path and optionally a different set of recorded probe boards');

// Observe the production entry points in a private module instance so test
// instrumentation does not enter the browser bundle or the regular matches.
const moduleUrl = new URL('../../src/core/ai/gravity-search.js', import.meta.url);
const source = readFileSync(moduleUrl, 'utf8').replace(/from '(\.\.?\/[^']+)'/g,
    (_, relative) => `from '${new URL(relative, moduleUrl).href}'`);
const observation = 'export { skylineLandings, completes, futureLandings, reachableTriggersAtRoof };';
const gravity = await import('data:text/javascript;base64,' + Buffer.from(source+'\n'+observation).toString('base64'));
const digest = createHash('sha256');
const seen = new Set();
const stats = {};

function inspect(grid, name) {
    const board = gravity.readGravityBoard(grid);
    if (board.top > board.first + 3) return;
    const id = gravity.gravityBoardKey(board.cells);
    if (seen.has(id)) return;
    seen.add(id);
    const sample = stats[name] ??= { boards: 0, poses: 0, reachable: 0, unreachable: 0, perShape: {} };
    sample.boards++;
    for (const key of Object.keys(SHAPES)) {
        const candidates = gravity.skylineLandings(board, key).filter(p => gravity.completes(board, p.form, p.x, p.y));
        const decisions = landings => candidates.map(({x, y, rotation}) =>
            [x, y, rotation, landings.some(p => p.x === x && p.y === y && p.rotation === rotation)]);
        const expected = candidates.length ? decisions(gravity.futureLandings(board, key)) : [];
        const actual = candidates.length ? decisions(gravity.reachableTriggersAtRoof(board, key)) : [];
        if (!isDeepStrictEqual(actual, expected)) throw Error(`Different ${key} trigger on ${name} board ${sample.boards}`);
        const reached = actual.filter(p => p[3]).length;
        sample.poses += actual.length;
        sample.reachable += reached;
        sample.unreachable += actual.length - reached;
        const shape = sample.perShape[key] ??= [0, 0];
        shape[0] += reached;
        shape[1] += actual.length;
        digest.update(JSON.stringify([key, actual]));
    }
}

for (const [, , cells] of JSON.parse(readFileSync(probes, 'utf8'))) {
    // The stored probe marks its synthetic row fills above the body ID range.
    const grid = [];
    for (let i = 0; i < cells.length; i += COLS) {
        grid.push(cells.slice(i, i + COLS).map(id => id && id < cells.length + 8
            ? { id, type: id < 0 ? 'GARBAGE' : 'I' } : null));
    }
    inspect(grid, 'recordedSearchBoards');
}
const packet = await captureGarbage();
const tiers = [1, 2, 3, 6, 8, 10];
const seeds = [10251, 10270];
for (const tier of tiers) for (let seed = seeds[0]; seed <= seeds[1]; seed++) {
    const seat = recordedSeat(tier, seed);
    let previous = -1;
    try {
        for (let tick=0; tick<45000 && seat.state.piecesPlaced<150 && !seat.state.isGameOver; tick++) {
            if (seat.state.currentPiece && !seat.state.isProcessingPhysics && previous !== seat.state.piecesPlaced) {
                previous = seat.state.piecesPlaced;
                if (previous === 12 || previous === 48) seat.queue.enqueue(packet);
                inspect(seat.state.boardGrid, 'nativeAttackedBoards');
            }
            seat.step();
        }
    } finally { seat.close(); }
}
writeFileSync(output, JSON.stringify({stats, digest:digest.digest('hex'), seeds, tiers}), {flag:'wx'});
