// Compare complete gravity search candidates and CPU on the same live standard wells.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { recordedSeat } from './recorded-seat.mjs';

const [output, ...paths] = process.argv.slice(2);
if (paths.length < 2) throw Error('Supply an output file followed by at least two gravity-search modules');
const modules = await Promise.all(paths.map(path => import(pathToFileURL(resolve(path)))));
const packet = await captureGarbage();
const fixtures = [];
for (const seed of [1001,1002,1003,1006,1011,1017]) {
    const seat = recordedSeat(10, seed);
    let last = -1;
    try {
        for (let tick = 0; tick < 30000 && !seat.state.isGameOver && last < 60; tick++) {
            const state = seat.state;
            if (!state.isProcessingPhysics && state.piecesPlaced !== last) {
                last = state.piecesPlaced;
                if (last === 12 && seed % 2) seat.queue.enqueue(packet);
                if ([4,8,16,24,32,40,48,56].includes(last)) fixtures.push(structuredClone({
                    boardGrid: state.boardGrid, currentPiece: state.currentPiece, nextPieces: state.nextPieces.slice(0,3),
                    lines: state.lines, level: state.level, linesUntilNextLevel: state.linesUntilNextLevel,
                    disableLevelProgression: state.disableLevelProgression,
                }));
            }
            seat.step();
        }
    } finally { seat.close(); }
}
const config = { previews: 3, width: 16, trigger: true, virtual: true, fireWaves: 4, safetyMargin: 6, attackStock: 36 };
const signatures = [];
function run(module, verify) {
    let units = 0;
    for (const [index, state] of fixtures.entries()) {
        let ready;
        const board = module.readGravityBoard(state.boardGrid);
        const search = module.searchGravity(state, config, 0, module.GRAVITY_WEIGHTS, candidate => { ready = candidate; }, board);
        for (let i = 0; i < 238; i++) {
            const step = search.next();
            if (step.done) { ready = step.value; break; }
            units++;
        }
        search.return();
        if (verify) {
            const key = JSON.stringify([ready.route.map(n => [n.move,n.quality,module.gravityBoardKey(n.parent.board.cells)]),
                ready.alternatives.map(n => [n.move.x,n.move.rotation,n.quality])]);
            if (module === modules[0]) signatures[index] = key;
            else if (signatures[index] !== key) throw Error('Changed forecast or ranking on fixture ' + index);
        }
    }
    return units;
}
for (const module of modules) run(module, true);
const methods = paths.map((path, index) => ({ path, module: modules[index], times: [] }));
for (let pass = 0; pass < 9; pass++) for (let j = 0; j < methods.length; j++) {
    const entry = methods[(pass + j) % methods.length];
    const before = process.cpuUsage(), start = performance.now();
    let units = 0;
    for (let batch = 0; batch < 3; batch++) units += run(entry.module, false);
    const used = process.cpuUsage(before);
    entry.times.push({ cpu: (used.user + used.system) / 1000, wall: performance.now() - start, units });
}
const garbage = fixtures.filter(state => modules[0].readGravityBoard(state.boardGrid).garbage).length;
writeFileSync(output, JSON.stringify({ boards: fixtures.length, garbage, methods: methods.map(({ path, times }) => ({ path, times })) }), { flag: 'wx' });
