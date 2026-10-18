/**
 * Fault Lines puzzle search: the offline tool the puzzle bank's later tiers came from.
 *
 * Search (worker threads, time-boxed; appends one JSON line per candidate):
 *   node scripts/fault-lines-search.mjs --out=candidates.jsonl --pieces=3 --minutes=20 --workers=4
 *     [--style=strata|deep] [--seed=7]
 * Rank what a search found (one goal per structure and supply, the hardest):
 *   node scripts/fault-lines-search.mjs --rank=candidates.jsonl [--pieces=3] [--goal=waves]
 *     [--top=20] [--maxRows=10] [--maxBodies=16] [--lanterns]
 *
 * One piece (--pieces=1) searches for First light: a cascade or lines from two up, or an empty
 * well, with at most a quarter of the openings winning and no relic (Undertow introduces it).
 * --lanterns keeps only structures with a lantern (First light's other puzzles assume them).
 *
 * Each candidate is a random structure (rows with one to three gaps, split into bodies, some
 * joined into two-row bodies, lanterns above) and a random supply. Every straight-drop line of
 * play is enumerated once on the real cascade resolver, and every goal the structure allows
 * is judged on that tree: the deepest cascade, the most lines, an empty well, each body as
 * the relic. A goal is kept when the last piece is needed, every piece matters, at most a
 * tenth of the openings win (two openings for two-piece supplies), and some winning lock
 * cascades at least two waves deep. Straight drops only: the certifier's real solver (tucks
 * and kicks included) has the last word, so a candidate goes into puzzle-bank.js without a
 * solution and tests/unit/fault-lines-puzzles.test.js decides (docs/FAULT_LINES_2026-10.md,
 * "Adding a puzzle").
 *
 * The rank's hardness rewards few winning openings and few solutions, an opening that clears
 * nothing (a set-up), a greedy opening (the biggest immediate clear) that loses, tempting
 * openings that clear and lose (traps), and a deeper goal.
 */
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const core = (path) => new URL(`../src/core/${path}`, import.meta.url).href;

const parseArgs = (argv) => Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? '1'];
}));

const goalLabel = (goal) => {
    if (goal.type === 'waves' || goal.type === 'lines') return `${goal.type} >= ${goal.atLeast}`;
    return goal.type === 'relic-floor' ? `relic ${goal.body}` : goal.type;
};

export function hardness(c) {
    let score = -Math.log2(c.winOpenings / c.openings);
    score += -Math.log2(c.solutions / c.lines) * 0.35;
    if (c.setup) score += 1.5;
    if (c.greedyLoses) score += 1.5;
    score += Math.min(c.traps, 6) * 0.25;
    if (c.goal.type === 'waves') score += Math.max(0, c.goal.atLeast - 3) * 0.6;
    if (c.goal.type === 'lines') score += Math.max(0, c.goal.atLeast - 4) * 0.4;
    if (c.goal.type === 'clear-all') score += 1;
    if (c.solutions === 1) score += 1;
    return score;
}

function rank(args) {
    const seen = new Map();
    for (const line of fs.readFileSync(args.rank, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const c = JSON.parse(line);
        const key = `${c.rows.join('/')}|${c.supply.join('')}`;
        if (Number(args.pieces || c.supply.length) !== c.supply.length) continue;
        if (c.rows.length > Number(args.maxRows || 11) || c.bodies > Number(args.maxBodies || 18)) continue;
        if (args.goal && c.goal.type !== args.goal) continue;
        if (args.lanterns && !c.rows.some((row) => /[a-z]/.test(row))) continue;
        const h = hardness(c);
        if (!seen.has(key) || seen.get(key).h < h) seen.set(key, { ...c, h });
    }
    const list = [...seen.values()].sort((a, b) => b.h - a.h);
    console.log(`${list.length} structures`);
    list.slice(0, Number(args.top || 20)).forEach((c, index) => {
        console.log(`\n#${index} hardness ${c.h.toFixed(2)} · ${c.supply.join(' ')} · ${goalLabel(c.goal)}`
            + ` · wins ${c.winOpenings}/${c.openings} openings, ${c.solutions} of ${c.lines} lines`
            + `${c.setup ? ' · set-up' : ''}${c.greedyLoses ? ' · greedy loses' : ''} · traps ${c.traps}`);
        console.log(c.rows.map((row) => `    '${row}',`).join('\n'));
        console.log(`    supply: ${JSON.stringify(c.supply)}, goal: ${JSON.stringify(c.goal)}`);
    });
}

function search(args) {
    const minutes = Number(args.minutes || 10);
    const seed = Number(args.seed || Date.now() % 100000);
    const stats = { tried: 0, kept: 0 };
    const workers = Array.from({ length: Number(args.workers || 4) }, (_, index) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
            workerData: {
                pieces: Number(args.pieces || 3), style: args.style || 'strata', seed: seed * 97 + index * 7919,
            },
        });
        worker.on('message', (message) => {
            if (message.type === 'tried') stats.tried += message.count;
            else {
                stats.kept += 1;
                fs.appendFileSync(args.out, `${JSON.stringify(message.candidate)}\n`);
            }
        });
        worker.on('error', (error) => console.error('[fault-lines-search] worker failed', error));
        return worker;
    });
    const started = Date.now();
    const timer = setInterval(() => {
        console.log(`${((Date.now() - started) / 60000).toFixed(1)} min: ${stats.tried} tried, ${stats.kept} kept`);
    }, 60000);
    setTimeout(() => {
        clearInterval(timer);
        console.log(`done: ${stats.tried} tried, ${stats.kept} kept in ${args.out}`);
        workers.forEach((worker) => worker.terminate());
    }, minutes * 60000);
}

async function work() {
    const { buildPuzzle, validatePuzzleDefinition } = await import(core('fault-lines/fault-lines-puzzle.js'));
    const {
        createRun, applyPlacement, boardFor, cellsOf,
    } = await import(core('fault-lines/fault-lines-sim.js'));
    const { SHAPES, COLS, HIDDEN_ROWS } = await import(core('constants.js'));
    const { rotateShapeMatrix } = await import(core('game.js'));
    const { pieces, style } = workerData;
    const deep = style === 'deep';

    let state = workerData.seed >>> 0 || 1;
    const rand = () => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 4294967296;
    };
    const randint = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const weighted = (pairs) => {
        let r = rand() * pairs.reduce((sum, [, w]) => sum + w, 0);
        for (const [value, w] of pairs) {
            r -= w;
            if (r <= 0) return value;
        }
        return pairs[pairs.length - 1][0];
    };

    // Straight drops: rotate and move on the deal row, then drop (the deal row is free).
    const rotations = {};
    for (const key of 'IOTSZLJ') {
        const shapes = [SHAPES[key]];
        for (let r = 1; r < 4; r += 1) shapes.push(rotateShapeMatrix(shapes[r - 1], 'right'));
        rotations[key] = shapes.map((shape) => {
            const cells = [];
            shape.forEach((row, dy) => row.forEach((c, dx) => { if (c > 0) cells.push([dx, dy]); }));
            return { shape, cells };
        });
    }
    const straightPlacements = (run) => {
        const key = run.puzzle.supply[run.dealt];
        if (!key || run.outcome !== 'open') return [];
        const grid = boardFor(run.lockedPieces);
        const fits = (cells, x, y) => cells.every(([dx, dy]) => {
            const bx = x + dx;
            const by = y + dy;
            if (bx < 0 || bx >= COLS || by >= grid.length) return false;
            return by < 0 || grid[by][bx] === null;
        });
        const spawnX = Math.floor(COLS / 2) - Math.floor(SHAPES[key][0].length / 2);
        const out = [];
        const seen = new Set();
        for (const r of key === 'O' ? [0] : [0, 1, 2, 3]) {
            const { shape, cells } = rotations[key][r];
            for (const dir of [-1, 1]) {
                for (let x = dir === -1 ? spawnX : spawnX + 1; fits(cells, x, HIDDEN_ROWS); x += dir) {
                    let y = HIDDEN_ROWS;
                    while (fits(cells, x, y + 1)) y += 1;
                    const footprint = cells.map(([dx, dy]) => `${x + dx},${y + dy}`).sort().join(';');
                    if (!seen.has(footprint)) {
                        seen.add(footprint);
                        out.push({
                            shapeKey: key, shape: shape.map((row) => row.slice()), rotation: r, x, y, actions: [], footprint,
                        });
                    }
                }
            }
        }
        return out;
    };

    const generate = () => {
        const strata = deep ? randint(5, 9) : randint(2, 7);
        const ids = Array.from({ length: strata }, () => Array(COLS).fill(-1));
        let next = 0;
        for (let y = 0; y < strata; y += 1) {
            const gapCount = weighted(deep ? [[1, 75], [2, 25]] : [[1, 55], [2, 35], [3, 10]]);
            const gaps = new Set();
            while (gaps.size < gapCount) gaps.add(randint(0, COLS - 1));
            let run = [];
            const flush = () => {
                for (let i = 0; i < run.length;) {
                    const length = Math.min(run.length - i, weighted([[1, 8], [2, 25], [3, 30], [4, 25], [5, 12]]));
                    for (let k = 0; k < length; k += 1) ids[y][run[i + k]] = next;
                    next += 1;
                    i += length;
                }
                run = [];
            };
            for (let x = 0; x < COLS; x += 1) {
                if (gaps.has(x)) flush();
                else run.push(x);
            }
            flush();
        }
        // Some bodies join the one beneath them: two-row bodies of at most six cells.
        const mergeChance = weighted([[0, 30], [0.12, 40], [0.25, 30]]);
        const merged = new Set();
        const sizeOf = (id) => ids.flat().filter((v) => v === id).length;
        for (let y = 0; y < strata - 1; y += 1) {
            for (let x = 0; x < COLS; x += 1) {
                const a = ids[y][x];
                const b = ids[y + 1][x];
                if (a < 0 || b < 0 || a === b || merged.has(a) || merged.has(b) || sizeOf(a) + sizeOf(b) > 6) continue;
                if (rand() < mergeChance) {
                    ids.forEach((row) => row.forEach((v, k) => { if (v === a) row[k] = b; }));
                    merged.add(b);
                }
            }
        }
        // Lanterns: small bodies hanging above the strata, apart from each other.
        const lanternCount = weighted([[0, 30], [1, 25], [2, 30], [3, 15]]);
        const lanternRows = lanternCount === 0 ? 0 : randint(2, Math.max(2, Math.min(deep ? 5 : 6, 13 - strata)));
        const above = Array.from({ length: lanternRows }, () => Array(COLS).fill(-1));
        const shapes = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]]];
        for (let i = 0; i < lanternCount; i += 1) {
            const cells = pick(shapes);
            const w = Math.max(...cells.map(([dx]) => dx)) + 1;
            const h = Math.max(...cells.map(([, dy]) => dy)) + 1;
            if (h > lanternRows) continue;
            const x = randint(0, COLS - w);
            const y = randint(0, lanternRows - h);
            const near = cells.some(([dx, dy]) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => (
                above[y + dy + oy]?.[x + dx + ox] >= 0)));
            if (near) continue;
            cells.forEach(([dx, dy]) => { above[y + dy][x + dx] = next; });
            next += 1;
        }
        const all = [...above, ...ids];
        while (all.length && all[0].every((v) => v < 0)) all.shift();
        if (all.length > 14 || all.length < 2) return null;
        if (new Set(all.flat().filter((v) => v >= 0)).size > 22) return null;
        // Letters in reading order; bodies with nothing beneath them are lowercase (lanterns).
        const supported = new Set();
        all.forEach((row, y) => row.forEach((v, x) => {
            if (v >= 0 && (y === all.length - 1 || (all[y + 1][x] >= 0 && all[y + 1][x] !== v))) supported.add(v);
        }));
        const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
        const lower = 'abcdefghjkmnpqrstuvwxyz';
        let u = 0;
        let l = 0;
        const letter = new Map();
        all.forEach((row) => row.forEach((v) => {
            if (v >= 0 && !letter.has(v)) letter.set(v, supported.has(v) ? upper[u++] : lower[l++]);
        }));
        if (u > upper.length || l > lower.length) return null;
        return all.map((row) => row.map((v) => (v < 0 ? '.' : letter.get(v))).join(''));
    };

    const coloursApart = (puzzle) => {
        const grid = boardFor(puzzle.lockedPieces);
        return grid.every((row, y) => row.every((cell, x) => !cell || [row[x + 1], grid[y + 1]?.[x]].every((other) => (
            !other || other.id === cell.id || other.type !== cell.type))));
    };

    // The whole straight-drop tree, with what each node's lock did.
    const enumerate = (puzzle, relicLetters) => {
        const open = { ...puzzle, goal: { type: 'lines', atLeast: 999 } };
        const floor = puzzle.boardHeight - 1;
        const relicIds = relicLetters.map((letter) => puzzle.bodyIds[letter]);
        const nodes = [];
        const relicState = (locked) => relicIds.map((id) => {
            const parts = locked.filter((p) => p.pieceId === id);
            if (parts.length === 0) return 0;
            return parts.some((p) => cellsOf(p).some(([, y]) => y === floor)) ? 2 : 1;
        });
        const visit = (run, parent, depth, lock) => {
            const index = nodes.length;
            nodes.push({
                depth, children: [], lines: run.lines, bestWaves: run.bestWaves, empty: run.lockedPieces.length === 0,
                relic: relicState(run.lockedPieces), ...lock,
            });
            if (parent >= 0) nodes[parent].children.push(index);
            if (run.outcome !== 'open') return;
            for (const placement of straightPlacements(run)) {
                const { run: after, resolution } = applyPlacement(run, placement);
                visit(after, index, depth + 1, {
                    waves: resolution.cascadeCount,
                    cleared: resolution.linesClearedThisTurn,
                    placement: { piece: placement.shapeKey, rotation: placement.rotation, x: placement.x },
                });
            }
        };
        visit(createRun(open), -1, 0, { waves: 0, cleared: 0, placement: null });
        return nodes;
    };

    const judge = (nodes, goal, relicIndex) => {
        const met = (n) => {
            if (goal.type === 'waves') return n.bestWaves >= goal.atLeast;
            if (goal.type === 'lines') return n.lines >= goal.atLeast;
            if (goal.type === 'clear-all') return n.empty;
            return n.relic[relicIndex] === 2;
        };
        const lost = (n) => goal.type === 'relic-floor' && n.relic[relicIndex] === 0;
        let solutions = 0;
        let lines = 0;
        let minDepth = Infinity;
        const paths = [];
        const walk = (i, path) => {
            const n = nodes[i];
            if (lost(n)) { lines += 1; return 0; }
            if (met(n)) {
                lines += 1;
                solutions += 1;
                minDepth = Math.min(minDepth, n.depth);
                if (paths.length < 12) paths.push(path);
                return 1;
            }
            if (n.children.length === 0) { lines += 1; return 0; }
            return n.children.reduce((sum, c) => sum + walk(c, [...path, c]), 0);
        };
        const openings = nodes[0].children;
        const greedy = Math.max(0, ...openings.map((c) => nodes[c].cleared));
        let winOpenings = 0;
        let traps = 0;
        let greedyWins = false;
        for (const c of openings) {
            const wins = walk(c, [c]) > 0;
            if (wins) winOpenings += 1;
            else if (nodes[c].cleared > 0) traps += 1;
            if (wins && nodes[c].cleared === greedy) greedyWins = true;
        }
        return {
            solvable: solutions > 0,
            solutions,
            lines,
            minDepth,
            openings: openings.length,
            winOpenings,
            traps,
            setup: paths.length > 0 && paths.every((p) => nodes[p[0]].cleared === 0),
            greedyLoses: greedy > 0 && !greedyWins,
            deepLock: Math.max(0, ...paths.map((p) => Math.max(...p.map((i) => nodes[i].waves)))),
            line: (paths[0] || []).map((i) => nodes[i].placement),
        };
    };

    let tried = 0;
    const seen = new Set();
    for (;;) {
        const rows = generate();
        if (!rows || seen.has(rows.join('/'))) continue;
        seen.add(rows.join('/'));
        const supply = Array.from({ length: pieces }, () => pick([...'IOTSZLJ']));
        const definition = {
            id: 'candidate', title: 'Candidate', rows, supply, goal: { type: 'clear-all' },
        };
        if (validatePuzzleDefinition(definition).length) continue;
        const puzzle = buildPuzzle(definition);
        if (!coloursApart(puzzle)) continue;
        tried += 1;
        if (tried % 20 === 0) parentPort.postMessage({ type: 'tried', count: 20 });
        const relicLetters = Object.keys(puzzle.bodyIds).filter((letter) => !rows[rows.length - 1].includes(letter));
        const nodes = enumerate(puzzle, relicLetters);
        const maxWaves = Math.max(...nodes.map((n) => n.bestWaves));
        const maxLines = Math.max(...nodes.map((n) => n.lines));
        const goals = [];
        const tutorial = pieces === 1;
        if (maxWaves >= (deep ? 4 : 3) || (tutorial && maxWaves >= 2)) goals.push({ type: 'waves', atLeast: maxWaves });
        if (maxWaves >= (deep ? 5 : 4)) goals.push({ type: 'waves', atLeast: maxWaves - 1 });
        if (maxLines >= (deep ? 5 : 4) || (tutorial && maxLines >= 2)) goals.push({ type: 'lines', atLeast: maxLines });
        if (nodes.some((n) => n.empty && n.depth > 0)) goals.push({ type: 'clear-all' });
        if (!deep && !tutorial) {
            relicLetters.forEach((body, relicIndex) => {
                if (nodes.some((n) => n.relic[relicIndex] === 2)) goals.push({ type: 'relic-floor', body, relicIndex });
            });
        }
        for (const { relicIndex, ...goal } of goals) {
            const verdict = judge(nodes, goal, relicIndex);
            if (!verdict.solvable || verdict.minDepth !== pieces || verdict.deepLock < 2) continue;
            const share = verdict.winOpenings / verdict.openings;
            if (tutorial ? share > 0.25 : share > 0.1 && !(pieces === 2 && verdict.winOpenings <= 2)) continue;
            // Every piece matters: without the leading pieces the goal is out of reach.
            let matters = true;
            for (let skip = 1; skip < pieces && matters; skip += 1) {
                const shorter = buildPuzzle({ ...definition, supply: supply.slice(skip) });
                if (judge(enumerate(shorter, relicLetters), goal, relicIndex).solvable) matters = false;
            }
            if (!matters) continue;
            const { minDepth, solvable, ...rest } = verdict;
            parentPort.postMessage({
                type: 'keep', candidate: { rows, supply, goal, ...rest, bodies: puzzle.lockedPieces.length },
            });
        }
    }
}

if (!isMainThread) {
    await work();
} else {
    const args = parseArgs(process.argv.slice(2));
    if (args.rank) rank(args);
    else if (args.out) search(args);
    else console.log('usage: --out=<file.jsonl> [--pieces --minutes --workers --style --seed] | --rank=<file.jsonl>');
}
