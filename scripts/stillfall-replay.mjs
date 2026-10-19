/**
 * Stillfall replay: plays a puzzle's stored solution through the live game (the real
 * controls from the deal row, a real hard drop, the async cascade physics) and prints the
 * board after each landing and at every wave, as the wave is detected, with the rows about to
 * clear marked. Read this before writing a lesson: it shows what really falls where.
 *
 *   node scripts/stillfall-replay.mjs <bank id> [<bank id> ...]
 *   node scripts/stillfall-replay.mjs --file=candidates.json
 *     (a JSON array of { rows, supply, goal, solution }, as puzzle-bank.js entries hold them)
 *
 * The structure's bodies keep their letters; the supply's pieces are numbered 1–4 in the
 * order they are dealt.
 */
import fs from 'node:fs';

const core = (path) => new URL(`../src/core/${path}`, import.meta.url).href;
const game = await import(core('game.js'));
const board = await import(core('board.js'));
const { buildPuzzle } = await import(core('stillfall/stillfall-puzzle.js'));
const sim = await import(core('stillfall/stillfall-sim.js'));
const { bankPuzzle } = await import(core('stillfall/puzzle-bank.js'));

const args = process.argv.slice(2);
const file = args.find((arg) => arg.startsWith('--file='))?.slice('--file='.length);
const definitions = file
    ? JSON.parse(fs.readFileSync(file, 'utf8')).map((entry, index) => ({
        id: `candidate-${index}`, title: `#${index}`, ...entry,
    }))
    : args.map((id) => bankPuzzle(id) || { missing: id });

/** The board from its top filled row down, bodies by letter and dealt pieces by number. */
function draw(grid, puzzle, clearing = new Set()) {
    const letterOf = new Map(Object.entries(puzzle.bodyIds).map(([letter, id]) => [id, letter]));
    const top = grid.findIndex((row) => row.some(Boolean));
    if (top < 0) return ['      (empty)'];
    return grid.slice(top).map((row, i) => {
        const y = top + i;
        const text = row.map((cell) => {
            if (!cell) return '.';
            return letterOf.get(cell.id) || String(cell.id - puzzle.nextPieceId + 1);
        }).join('');
        return `      ${String(y).padStart(2)} ${text}${clearing.has(y) ? '  <- clears' : ''}`;
    });
}

for (const definition of definitions) {
    if (definition.missing) {
        console.log(`\nno bank puzzle '${definition.missing}'`);
        continue;
    }
    const puzzle = buildPuzzle(definition);
    const gameState = new game.GameState({ hitStopEnabled: false, finiteSupply: true, gravityWaits: true });
    gameState.isSeeking = true; // physics skips its animation delays
    gameState.lockedPieces = puzzle.lockedPieces.map((piece) => ({
        ...piece, shape: piece.shape.map((row) => row.slice()),
    }));
    gameState._pieceIdCounter = puzzle.nextPieceId - 1;
    gameState.nextPieces = puzzle.supply.slice();
    board.rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    board.markBoardDirty(gameState);
    let waves = [];
    const callbacks = {
        onLineClear: (count, holes, masks, rows, wave) => {
            waves.push(`    wave ${wave}: ${count} row${count > 1 ? 's' : ''}`);
            waves.push(...draw(gameState.boardGrid, puzzle, new Set(rows || [])));
        },
        spawnPiece: () => {},
    };
    game.spawnPiece(gameState);
    sim.dealIntoView(gameState);
    console.log(`\n${definition.title} · ${puzzle.supply.join(' ')} · ${JSON.stringify(puzzle.goal)}`);
    let run = sim.createRun(puzzle);
    for (const step of puzzle.solution) {
        const placement = sim.solutionPlacement(run, step);
        if (!placement) {
            console.log(`  step ${JSON.stringify(step)} is not a landing the controls reach`);
            break;
        }
        for (const action of placement.actions) {
            if (action.type === 'move') game.move(gameState, action.dir);
            else if (action.type === 'rotate') game.rotate(gameState, action.dir);
            else if (action.type === 'softDrop') game.softDrop(gameState, null, callbacks);
        }
        const landed = board.rebuildBoardGridFromPieces([
            ...gameState.lockedPieces,
            { ...placement, pieceId: run.nextPieceId, type: placement.shapeKey },
        ], board.createBoardGrid());
        waves = [];
        game.hardDrop(gameState, null, callbacks);
        // eslint-disable-next-line no-await-in-loop
        await gameState.latestPhysicsPromise;
        ({ run } = sim.applyPlacement(run, placement));
        console.log(`  lock ${run.dealt}: ${step.piece}, ${step.rotation} right turns, column ${step.x}`);
        draw(landed, puzzle).forEach((line) => console.log(line));
        waves.forEach((line) => console.log(line));
        if (gameState.nextPieces.length > 0) {
            game.spawnPiece(gameState);
            sim.dealIntoView(gameState);
        }
    }
    console.log(`  after: ${run.lines} lines, deepest cascade ${run.bestWaves}, ${run.outcome}`);
    draw(gameState.boardGrid, puzzle).forEach((line) => console.log(line));
}
