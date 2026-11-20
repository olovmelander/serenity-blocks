// Bounded offline chain search. The production resolver decides every branch and the live
// controls replay the witness. Only the search ranking uses hypothetical row completion.
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SHAPES, COLS, HIDDEN_ROWS } from '../../src/core/constants.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { reachableLandings } from '../../src/core/stillfall/stillfall-reach.js';
import { simulateCellFill } from '../../src/core/ai/cascade-simulator.js';
import { analyzeCascadePreparation, rankCandidates } from '../../src/core/ai/board-evaluator.js';
import { estimateLatentDischarge } from '../../src/core/ai/latent-chain.js';
import { findReachablePlacements } from '../../src/core/ai/reachability-pathfinder.js';
import { PuzzleBotController } from '../../src/core/ai/puzzle-bot-controller.js';
import { connectivityBoardKey } from '../../scripts/odyssey-benchmark/profiles.mjs';
import { deal, spawn, replay, pose } from './solo.mjs';

function spawnPose(key) {
    return { shape: SHAPES[key], shapeKey: key, x: Math.floor(COLS / 2) - Math.floor(SHAPES[key][0].length / 2),
        y: HIDDEN_ROWS - 2, rotation: 0 };
}

function footprint(p) {
    const cells = [];
    p.shape.forEach((row, dy) => row.forEach((v, dx) => {
        if (v) cells.push((p.y + dy) * COLS + p.x + dx);
    }));
    return cells;
}

function actions(p) { return [...p.actions, { type: 'hardDrop' }]; }

// No lane/shape template. Reward inventory distributed across columns and the waves a
// near-full row could release. The virtual fills never become nodes or count as fires.
function potential(board) {
    const counts = Array(COLS).fill(0);
    let tension = 0;
    let maxH = 0;
    const rows = [];
    for (let y = board.length - 1; y >= HIDDEN_ROWS; y--) {
        const holes = [];
        let filled = 0;
        for (let x = 0; x < COLS; x++) {
            if (board[y][x]) { counts[x]++; filled++; }
            else holes.push({ x, y });
        }
        if (!filled) break;
        maxH = board.length - y;
        tension += filled * filled;
        if (holes.length && holes.length <= 3) rows.push(holes);
    }
    let discharge = 0;
    for (const holes of rows.slice(0, 2)) {
        const sim = simulateCellFill({ boardGrid: board }, holes);
        discharge = Math.max(discharge, sim.cascadeCount * 65 + sim.totalLines * 5 - holes.length * 8);
    }
    const material = counts.reduce((a, b) => a + b, 0);
    return discharge + 12 * Math.min(...counts) + tension * 0.14 + material * 1.5
        - maxH * 1.8 - Math.max(0, maxH - 14) ** 2 * 6;
}

function bestPath(node) {
    const path = [];
    for (let n = node; n.parent; n = n.parent) path.unshift(n.move);
    return path;
}

// Test full tetrominoes. Missing-cell counts discard only landings that cannot start a wave.
// All seven shapes describe capacity. A trigger in the remaining preview receives additional credit.
function reachablePotential(node, known, stats) {
    const gaps = node.board.map(row => row.reduce((total, c) => total + Number(!c), 0));
    if (!gaps.slice(HIDDEN_ROWS).some(gap => gap <= 4)) return 0;
    let best = 0;
    for (const key of Object.keys(SHAPES)) {
        const seen = new Set();
        for (const p of reachableLandings(node.board, spawnPose(key))) {
            const cells = footprint(p);
            const rowCounts = new Map();
            for (const cell of cells) {
                const y = Math.floor(cell / COLS);
                rowCounts.set(y, 1 + (rowCounts.get(y) || 0));
            }
            if (![...rowCounts].some(([y, count]) => y >= HIDDEN_ROWS && count === gaps[y])) continue;
            const id = cells.join(',');
            if (seen.has(id)) continue;
            seen.add(id);
            const result = resolveCascade([...node.pieces, { ...p, shapeKey: key, pieceId: 'potential' }],
                { level: 1, disableLevelProgression: true });
            stats.triggerSimulations++;
            const available = known.includes(key) ? 1 : 0.65;
            const value = (result.cascadeCount ** 2 * 32 + result.linesClearedThisTurn * 4) * available;
            best = Math.max(best, value);
        }
    }
    return best;
}

function search(board, pieces, keys, width, start, stats, strategy) {
    let beam = [{ board, pieces, parent: null, quality: 0 }];
    let best = null;
    for (let ply = 0; ply < keys.length; ply++) {
        const key = keys[ply];
        const next = [];
        for (const parent of beam) {
            const unique = new Set();
            const siblings = [];
            for (const p of reachableLandings(parent.board, spawnPose(key))) {
                const cells = footprint(p);
                const keyPose = cells.join(',');
                if (unique.has(keyPose)) continue;
                unique.add(keyPose);
                const piece = { ...p, shapeKey: key, type: key, color: key, pieceId: 'search-' + (start + ply) };
                const result = resolveCascade([...parent.pieces, piece], { level: 1, disableLevelProgression: true });
                stats.nodes++;
                const node = { board: result.boardAfter, pieces: result.lockedPiecesAfter, parent,
                    move: { shapeKey: key, x: p.x, y: p.y, rotation: p.rotation, actions: actions(p),
                        waves: result.waves.map((wave) => wave.fullLines.length) },
                    quality: potential(result.boardAfter) };
                const depth = result.waves.length;
                if (depth && (!best || depth > best.move.waves.length
                    || (depth === best.move.waves.length && result.linesClearedThisTurn > best.lines))) {
                    node.lines = result.linesClearedThisTurn;
                    best = node;
                }
                siblings.push(node);
            }
            siblings.sort((a, b) => b.quality - a.quality);
            next.push(...siblings.slice(0, Math.max(6, Math.ceil(width / 2))));
        }
        next.sort((a, b) => b.quality - a.quality);
        if (strategy !== 'unrestricted') {
            next.length = Math.min(next.length, width * 2);
        }
        if (strategy === 'reachable') {
            const known = keys.slice(ply + 1, ply + 4);
            for (const node of next) node.quality += reachablePotential(node, known, stats);
            next.sort((a, b) => b.quality - a.quality);
        }
        const seen = new Set();
        beam = [];
        for (const node of next) {
            const identity = connectivityBoardKey(node.board);
            if (seen.has(identity)) continue;
            seen.add(identity);
            beam.push(node);
            if (beam.length === width) break;
        }
        if (!beam.length) break;
    }
    return { fire: best && bestPath(best), best: beam[0] && bestPath(beam[0]) };
}

function inspectChoice(state, move) {
    const bot = new PuzzleBotController({ playerIndex: 0, playerState: state, difficulty: 10, actions: {}, rng: () => 0.5 });
    const candidates = bot.evaluatePlacements(state, findReachablePlacements(state));
    const ranked = rankCandidates(candidates, bot.config, bot.rng);
    const selected = ranked.find((c) => pose(c) === pose(move));
    if (!selected) throw Error('Witness missing from live reachability');
    const metrics = selected.evaluation.metrics;
    return { rank: 1 + ranked.indexOf(selected), total: ranked.length, holes: metrics.holes,
        protected: metrics.preparationAfter.protectedLaneHoleCells, latent: metrics.latentDischarge?.latentComplexity ?? null,
        holeDifference: metrics.holes - ranked[0].evaluation.metrics.holes,
        scoreGap: Math.round(ranked[0].evaluation.score - selected.evaluation.score),
        shapeScore: metrics.projectedScore };
}

export async function searchRun(seed, mode = 'oracle', width = 20, limit = 16, timePlans = false) {
    if (!['visible', 'visible-shortlist', 'visible-reachable', 'oracle', 'oracle-reachable'].includes(mode)) {
        throw new RangeError('Unknown audit search mode ' + mode);
    }
    if (![width, limit].every(n => Number.isSafeInteger(n) && n > 0)) {
        throw new RangeError('Beam width and lock limit must be positive integers');
    }
    const state = deal(seed);
    const stats = { nodes: 0, triggerSimulations: 0 };
    const planTimesMs = [];
    const oracle = mode === 'oracle' || mode === 'oracle-reachable';
    const strategy = mode.endsWith('-reachable') ? 'reachable' : mode.endsWith('-shortlist') ? 'shortlist' : 'unrestricted';
    const trace = [];
    const locks = [];
    let waveLines = [];
    const callbacks = { spawnPiece: () => spawn(state), onLineClear: (n) => waveLines.push(n) };
    let queued = [];
    const plan = (keys, start) => {
        const t0 = timePlans ? performance.now() : 0;
        const found = search(state.boardGrid, state.lockedPieces, keys, width, start, stats, strategy);
        if (timePlans) planTimesMs.push(performance.now() - t0);
        return found;
    };
    if (oracle) {
        // Deal the identical seeded stream by normal spawns on a separate empty board.
        const supplier = deal(seed);
        const keys = [];
        for (let i = 0; i < limit; i++) { keys.push(supplier.currentPiece.shapeKey); spawn(supplier); }
        supplier.reset();
        const result = plan(keys, 0);
        queued = result.fire || result.best;
    }
    while (locks.length < limit && !state.isGameOver) {
        if (!queued?.length) {
            if (oracle) break;
            const keys = [state.currentPiece.shapeKey, ...state.nextPieces.slice(0, 3)].slice(0, limit - locks.length);
            const result = plan(keys, locks.length);
            // Keep a proof of a four-wave discharge inside the visible queue. Otherwise
            // choose the first move and observe the new preview before planning again.
            if (result.fire?.at(-1).waves.length >= 4) queued = result.fire;
            else queued = [(keys.length < 4 && result.fire?.length ? result.fire : result.best || result.fire)[0]];
        }
        const m = queued.shift();
        if (m.shapeKey !== state.currentPiece.shapeKey) throw Error('Wrong deal');
        const pre = analyzeCascadePreparation(state.boardGrid, state.nextPieces.slice(0, 3));
        const latent = estimateLatentDischarge(state.boardGrid, pre.sideLanes, [m.shapeKey, ...state.nextPieces.slice(0, 2)]);
        const before = inspectChoice(state, m);
        waveLines = [];
        await replay(state, m.actions, callbacks);
        if (JSON.stringify(waveLines) !== JSON.stringify(m.waves)) throw Error('Witness replay diverged');
        locks.push(waveLines.length);
        trace.push({ key: m.shapeKey, x: m.x, y: m.y, r: m.rotation, waves: waveLines, ...before,
            preEdgeReady: pre.sideLanes.some((l) => l.triggerReady),
            preLoaded: pre.sideLanes.some((l) => l.payloadLoaded), preProbe: latent.latentComplexity,
            preStaircase: pre.staircaseMatch, inputs: m.actions.length });
    }
    const result = { mode, seed, width, limit, ...stats, deepest: Math.max(0, ...locks), trace, topOut: state.isGameOver };
    if (timePlans) result.planTimesMs = planTimesMs;
    state.reset();
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [mode, first, count, width, file, timing] = process.argv.slice(2);
    writeFileSync(file, '', { flag: 'wx' });
    for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
        const value = await searchRun(seed, mode, Number(width), 16, timing === '--time');
        appendFileSync(file, JSON.stringify(value) + '\n');
    }
}
