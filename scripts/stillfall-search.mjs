/**
 * Stillfall puzzle search: the offline tool the puzzle bank's later tiers came from.
 *
 * Search (worker threads, time-boxed; appends one JSON line per candidate):
 *   node scripts/stillfall-search.mjs --out=candidates.jsonl --pieces=3 --minutes=20 --workers=4
 *     [--style=strata|deep|tall|tower] [--goals=single|seal|pair] [--seed=7]
 * Rank what a search found (one goal per structure and supply, the hardest):
 *   node scripts/stillfall-search.mjs --rank=candidates.jsonl [--pieces=3] [--goal=waves]
 *     [--has=seal] [--oneWay] [--top=20] [--maxRows=10] [--maxBodies=16] [--lanterns]
 *
 * --style=tower builds nine to thirteen nearly full strata of longer bodies (up to fourteen rows
 * with lanterns), for the five-piece tiers; rank it with --maxRows=14 --maxBodies=26.
 *
 * One piece (--pieces=1) searches for First light: a cascade or lines from two up, or an empty
 * well, with at most a quarter of the openings winning and no relic (Undertow introduces it).
 * --lanterns keeps only structures with a lantern (First light's other puzzles assume them).
 *
 * --goals picks what is judged on each structure: `single` (the default) the deepest cascade,
 * the most lines, an empty well and each body as the relic; `seal` each body as a seal (it
 * must be cleared away entirely); `pair` two goals at once (two relics, two seals, a relic and
 * a seal, or a cascade or lines together with an empty well, a relic or a seal). A pair is
 * kept only when it is harder than each of its parts alone.
 *
 * Each candidate is a random structure (rows with one to three gaps, split into bodies, some
 * joined into two-row bodies, lanterns above) and a random supply. Every straight-drop line of
 * play is enumerated once (clears resolved by stillfall-cascade.js, the real resolver's answer
 * held to it lock for lock), and every goal is judged on that tree.
 * The last piece's landings that complete no row are counted, not resolved: nothing falls
 * without a clear, so no goal can be met by them. A goal is kept when the last piece is
 * needed, every piece matters, at most a tenth of the openings win (two openings for two-piece
 * supplies), and some winning lock cascades at least two waves deep. Straight drops only: the
 * certifier's real solver (tucks and kicks included) has the last word, so a candidate goes
 * into puzzle-bank.js without a solution and tests/unit/stillfall-puzzles.test.js decides
 * (docs/STILLFALL_2026-10.md, "Adding a puzzle").
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
    if (goal.type === 'all') return goal.of.map(goalLabel).join(' + ');
    if (goal.type === 'waves' || goal.type === 'lines') return `${goal.type} >= ${goal.atLeast}`;
    if (goal.type === 'relic-floor') return `relic ${goal.body}`;
    return goal.type === 'seal' ? `seal ${goal.body}` : goal.type;
};

/** What a goal adds to a candidate's hardness on its own. */
const goalBonus = (goal) => {
    if (goal.type === 'all') return 1 + goal.of.reduce((sum, part) => sum + goalBonus(part), 0);
    if (goal.type === 'waves') return Math.max(0, goal.atLeast - 3) * 0.6;
    if (goal.type === 'lines') return Math.max(0, goal.atLeast - 4) * 0.4;
    if (goal.type === 'clear-all') return 1;
    return goal.type === 'seal' ? 0.5 : 0;
};

export function hardness(c) {
    let score = -Math.log2(c.winOpenings / c.openings);
    score += -Math.log2(c.solutions / c.lines) * 0.35;
    if (c.setup) score += 1.5;
    if (c.greedyLoses) score += 1.5;
    score += Math.min(c.traps, 6) * 0.25;
    score += goalBonus(c.goal);
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
        // --has=seal keeps goals that involve a seal anywhere, alone or as part of two.
        if (args.has && !goalLabel(c.goal).includes(args.has)) continue;
        if (args.oneWay && c.winOpenings !== 1) continue;
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
                pieces: Number(args.pieces || 3),
                style: args.style || 'strata',
                goals: args.goals || 'single',
                seed: seed * 97 + index * 7919,
            },
        });
        worker.on('message', (message) => {
            if (message.type === 'tried') stats.tried += message.count;
            else {
                stats.kept += 1;
                fs.appendFileSync(args.out, `${JSON.stringify(message.candidate)}\n`);
            }
        });
        worker.on('error', (error) => console.error('[stillfall-search] worker failed', error));
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
    const { buildPuzzle, validatePuzzleDefinition } = await import(core('stillfall/stillfall-puzzle.js'));
    const {
        createRun, boardFor, boardOf, cellsOf, stepAfter,
    } = await import(core('stillfall/stillfall-sim.js'));
    const { SHAPES, COLS, HIDDEN_ROWS } = await import(core('constants.js'));
    const { rotateShapeMatrix } = await import(core('game.js'));
    const { pieces, style, goals: goalKinds } = workerData;
    const deep = style === 'deep';
    // A tower: nine to thirteen strata of longer bodies, nearly full, with the relic kept.
    const tower = style === 'tower';

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
    const straightPlacements = (run, grid) => {
        const key = run.puzzle.supply[run.dealt];
        if (!key || run.outcome !== 'open') return [];
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
                            shapeKey: key, shape: shape.map((row) => row.slice()), rotation: r, x, y, actions: [], footprint, cells,
                        });
                    }
                }
            }
        }
        return out;
    };
    /** Whether a landing fills the last empty cells of some row. */
    const completesRow = (grid, placement) => {
        const rowsHit = new Set(placement.cells.map(([, dy]) => placement.y + dy));
        for (const y of rowsHit) {
            let full = true;
            for (let x = 0; x < COLS && full; x += 1) {
                if (grid[y][x] !== null) continue;
                full = placement.cells.some(([dx, dy]) => placement.x + dx === x && placement.y + dy === y);
            }
            if (full) return true;
        }
        return false;
    };

    const generate = () => {
        const [fewest, most] = { deep: [5, 9], tall: [4, 9], tower: [9, 13] }[style] || [2, 7];
        const strata = randint(fewest, most);
        const ids = Array.from({ length: strata }, () => Array(COLS).fill(-1));
        let next = 0;
        for (let y = 0; y < strata; y += 1) {
            const gapCount = weighted({
                deep: [[1, 75], [2, 25]], tall: [[1, 50], [2, 40], [3, 10]], tower: [[1, 60], [2, 35], [3, 5]],
            }[style] || [[1, 55], [2, 35], [3, 10]]);
            const gaps = new Set();
            while (gaps.size < gapCount) gaps.add(randint(0, COLS - 1));
            let run = [];
            const flush = () => {
                for (let i = 0; i < run.length;) {
                    const length = Math.min(run.length - i, weighted(tower
                        ? [[2, 10], [3, 30], [4, 35], [5, 25]]
                        : [[1, 8], [2, 25], [3, 30], [4, 25], [5, 12]]));
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
        // Some bodies join the one beneath them: two-row bodies of at most six cells (eight in a tower).
        const mergeChance = weighted(tower ? [[0.15, 40], [0.3, 40], [0.45, 20]] : [[0, 30], [0.12, 40], [0.25, 30]]);
        const mergedMost = tower ? 8 : 6;
        const merged = new Set();
        const sizeOf = (id) => ids.flat().filter((v) => v === id).length;
        for (let y = 0; y < strata - 1; y += 1) {
            for (let x = 0; x < COLS; x += 1) {
                const a = ids[y][x];
                const b = ids[y + 1][x];
                if (a < 0 || b < 0 || a === b || merged.has(a) || merged.has(b) || sizeOf(a) + sizeOf(b) > mergedMost) continue;
                if (rand() < mergeChance) {
                    ids.forEach((row) => row.forEach((v, k) => { if (v === a) row[k] = b; }));
                    merged.add(b);
                }
            }
        }
        // Lanterns: small bodies hanging above the strata, apart from each other.
        // A tower keeps them within the tallest structure (14 rows).
        let lanternCount = weighted(tower ? [[0, 40], [1, 30], [2, 25], [3, 5]] : [[0, 30], [1, 25], [2, 30], [3, 15]]);
        if (tower && 14 - strata < 2) lanternCount = 0;
        const lanternRows = lanternCount === 0 ? 0 : randint(2, Math.max(2, Math.min(deep ? 5 : 6, (tower ? 14 : 13) - strata)));
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
        if (new Set(all.flat().filter((v) => v >= 0)).size > (tower ? 26 : 22)) return null;
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

    // The whole straight-drop tree, with what each node's lock did. Bodies are bits in two
    // masks: which are still on the board, and which have a cell on the floor. The last
    // piece's landings that complete no row are only counted (`dead`): nothing moves.
    const enumerate = (puzzle) => {
        const open = { ...puzzle, goal: { type: 'lines', atLeast: 999 } };
        const floor = puzzle.boardHeight - 1;
        const bodyCount = puzzle.nextPieceId - 1;
        const nodes = [];
        const masks = (locked) => {
            let present = 0;
            let onFloor = 0;
            for (const p of locked) {
                if (p.pieceId > bodyCount) continue;
                const bit = 1 << (p.pieceId - 1);
                present |= bit;
                if (cellsOf(p).some(([, y]) => y === floor)) onFloor |= bit;
            }
            return { present, onFloor };
        };
        const visit = (run, parent, depth, lock) => {
            const index = nodes.length;
            nodes.push({
                depth,
                children: [],
                dead: 0,
                lines: run.lines,
                bestWaves: run.bestWaves,
                empty: run.lockedPieces.length === 0,
                ...masks(run.lockedPieces),
                ...lock,
            });
            if (parent >= 0) nodes[parent].children.push(index);
            if (run.outcome !== 'open') return;
            const grid = boardOf(run);
            const last = run.dealt === run.puzzle.supply.length - 1;
            for (const placement of straightPlacements(run, grid)) {
                const clears = completesRow(grid, placement);
                if (last && !clears) {
                    nodes[index].dead += 1;
                    continue;
                }
                const step = { piece: placement.shapeKey, rotation: placement.rotation, x: placement.x };
                // A lock that clears nothing resolves no cascade; one that clears, the fast one
                // (stillfall-cascade.js, held to the real resolver lock for lock).
                const { run: after, cascadeCount, linesCleared } = stepAfter(run, placement);
                visit(after, index, depth + 1, { waves: cascadeCount, cleared: linesCleared, placement: step });
            }
        };
        visit(createRun(open), -1, 0, { waves: 0, cleared: 0, placement: null });
        return nodes;
    };

    /** A goal as two tests on a node: met, and lost for good (a relic cleared away). */
    const compile = (goal, bodyBit) => {
        if (goal.type === 'all') {
            const parts = goal.of.map((part) => compile(part, bodyBit));
            return { met: (n) => parts.every((p) => p.met(n)), lost: (n) => parts.some((p) => p.lost(n)) };
        }
        const never = () => false;
        if (goal.type === 'waves') return { met: (n) => n.bestWaves >= goal.atLeast, lost: never };
        if (goal.type === 'lines') return { met: (n) => n.lines >= goal.atLeast, lost: never };
        if (goal.type === 'clear-all') return { met: (n) => n.empty, lost: never };
        const bit = bodyBit[goal.body];
        if (goal.type === 'seal') return { met: (n) => (n.present & bit) === 0, lost: never };
        return { met: (n) => (n.onFloor & bit) !== 0, lost: (n) => (n.present & bit) === 0 };
    };

    const judge = (nodes, goal, bodyBit) => {
        const { met, lost } = compile(goal, bodyBit);
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
            if (n.children.length === 0 && n.dead === 0) { lines += 1; return 0; }
            lines += n.dead;
            return n.children.reduce((sum, c) => sum + walk(c, [...path, c]), 0);
        };
        const openings = nodes[0].children;
        lines += nodes[0].dead;
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
            openings: openings.length + nodes[0].dead,
            winOpenings,
            traps,
            setup: paths.length > 0 && paths.every((p) => nodes[p[0]].cleared === 0),
            greedyLoses: greedy > 0 && !greedyWins,
            deepLock: Math.max(0, ...paths.map((p) => Math.max(...p.map((i) => nodes[i].waves)))),
            line: (paths[0] || []).map((i) => nodes[i].placement),
        };
    };

    /** The largest value over a tree's nodes (a five-piece tree is too big to spread). */
    const most = (list, value) => list.reduce((best, n) => Math.max(best, value(n)), -Infinity);

    /** The goals worth judging on one tree, by the kinds this search asked for. */
    const goalsFor = (nodes, rows, letters, bodyBit) => {
        const tutorial = pieces === 1;
        const later = nodes.filter((n) => n.depth > 0);
        const maxWaves = most(nodes, (n) => n.bestWaves);
        const maxLines = most(nodes, (n) => n.lines);
        const relics = letters.filter((letter) => !rows[rows.length - 1].includes(letter)
            && later.some((n) => (n.onFloor & bodyBit[letter]) !== 0));
        const seals = letters.filter((letter) => later.some((n) => (n.present & bodyBit[letter]) === 0));
        const goals = [];
        if (goalKinds === 'single') {
            const tall = deep || tower;
            if (maxWaves >= (tall ? 4 : 3) || (tutorial && maxWaves >= 2)) goals.push({ type: 'waves', atLeast: maxWaves });
            if (maxWaves >= (tall ? 5 : 4)) goals.push({ type: 'waves', atLeast: maxWaves - 1 });
            if (maxLines >= (tall ? 5 : 4) || (tutorial && maxLines >= 2)) goals.push({ type: 'lines', atLeast: maxLines });
            if (later.some((n) => n.empty)) goals.push({ type: 'clear-all' });
            if (!deep && !tutorial) relics.forEach((body) => goals.push({ type: 'relic-floor', body }));
            return goals;
        }
        if (goalKinds === 'seal') {
            seals.forEach((body) => goals.push({ type: 'seal', body }));
            return goals;
        }
        // Two goals at once: two marked bodies, or a count together with a marked body or an
        // empty well (the count is the best the tree reaches while the other part holds).
        const states = [
            ...relics.map((body) => ({ type: 'relic-floor', body })),
            ...seals.map((body) => ({ type: 'seal', body })),
        ];
        if (later.some((n) => n.empty)) states.push({ type: 'clear-all' });
        for (let i = 0; i < states.length; i += 1) {
            for (let j = i + 1; j < states.length; j += 1) {
                const [a, b] = [states[i], states[j]];
                if (a.type === 'clear-all' || b.type === 'clear-all') continue; // an empty well is a pair's count
                if (a.body === b.body) continue;
                const both = { type: 'all', of: [a, b] };
                const { met } = compile(both, bodyBit);
                if (later.some(met)) goals.push(both);
            }
        }
        for (const s of states) {
            const { met } = compile(s, bodyBit);
            const holding = later.filter(met);
            if (holding.length === 0) continue;
            const waves = most(holding, (n) => n.bestWaves);
            if (waves >= 3) goals.push({ type: 'all', of: [{ type: 'waves', atLeast: waves }, s] });
            const lines = most(holding, (n) => n.lines);
            if (s.type !== 'clear-all' && lines >= 4) goals.push({ type: 'all', of: [{ type: 'lines', atLeast: lines }, s] });
        }
        // A tree with many bodies offers hundreds of pairs: judge a sample.
        while (goals.length > 60) goals.splice(Math.floor(rand() * goals.length), 1);
        return goals;
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
        const letters = Object.keys(puzzle.bodyIds);
        const bodyBit = Object.fromEntries(letters.map((letter) => [letter, 1 << (puzzle.bodyIds[letter] - 1)]));
        const nodes = enumerate(puzzle);
        // The trees without the leading pieces, built once and shared by every goal.
        const shorter = [];
        const shorterTree = (skip) => {
            if (!shorter[skip]) shorter[skip] = enumerate(buildPuzzle({ ...definition, supply: supply.slice(skip) }));
            return shorter[skip];
        };
        const tutorial = pieces === 1;
        for (const goal of goalsFor(nodes, rows, letters, bodyBit)) {
            const verdict = judge(nodes, goal, bodyBit);
            if (!verdict.solvable || verdict.minDepth !== pieces || verdict.deepLock < 2) continue;
            const share = verdict.winOpenings / verdict.openings;
            if (tutorial ? share > 0.25 : share > 0.1 && !(pieces === 2 && verdict.winOpenings <= 2)) continue;
            // A pair must be harder than each of its parts alone.
            if (goal.type === 'all' && goal.of.some((part) => judge(nodes, part, bodyBit).solutions <= verdict.solutions)) continue;
            // Every piece matters: without the leading pieces the goal is out of reach.
            let matters = true;
            for (let skip = 1; skip < pieces && matters; skip += 1) {
                if (judge(shorterTree(skip), goal, bodyBit).solvable) matters = false;
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
    else console.log('usage: --out=<file.jsonl> [--pieces --minutes --workers --style --goals --seed] | --rank=<file.jsonl>');
}
