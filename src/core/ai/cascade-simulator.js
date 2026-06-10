import { COLS, HIDDEN_ROWS, ROWS } from '../constants.js';
import { cloneBoardGrid, createBoardGrid } from '../board.js';

function isFilled(cell) {
    return cell !== null && cell !== undefined;
}

function cloneGridOrEmpty(boardGrid) {
    if (boardGrid) return cloneBoardGrid(boardGrid);
    return createBoardGrid();
}

function makeCell(id, type) {
    return {
        id,
        type,
        color: type,
    };
}

function positionKey(x, y) {
    return `${x},${y}`;
}

function detectFullLines(boardGrid) {
    const fullLines = [];
    for (let y = boardGrid.length - 1; y >= HIDDEN_ROWS; y--) {
        let full = true;
        for (let x = 0; x < COLS; x++) {
            if (!isFilled(boardGrid[y]?.[x])) {
                full = false;
                break;
            }
        }
        if (full) fullLines.push(y);
    }
    return fullLines;
}

function countFilledCells(boardGrid) {
    let count = 0;
    for (let y = 0; y < boardGrid.length; y++) {
        for (let x = 0; x < COLS; x++) {
            if (isFilled(boardGrid[y]?.[x])) count++;
        }
    }
    return count;
}

function getCellId(cell, x, y) {
    if (cell?.id !== undefined && cell?.id !== null) return cell.id;
    return `cell:${x}:${y}`;
}

function findComponents(boardGrid) {
    const visited = Array.from({ length: boardGrid.length }, () => Array(COLS).fill(false));
    const components = [];
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let y = 0; y < boardGrid.length; y++) {
        for (let x = 0; x < COLS; x++) {
            const startCell = boardGrid[y]?.[x];
            if (!isFilled(startCell) || visited[y][x]) continue;

            const id = getCellId(startCell, x, y);
            const stack = [{ x, y }];
            const cells = [];
            visited[y][x] = true;

            while (stack.length > 0) {
                const current = stack.pop();
                const cell = boardGrid[current.y]?.[current.x];
                if (!isFilled(cell) || getCellId(cell, current.x, current.y) !== id) continue;

                cells.push({
                    x: current.x,
                    y: current.y,
                    cell,
                });

                for (const [dx, dy] of directions) {
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    if (
                        nx < 0
                        || nx >= COLS
                        || ny < 0
                        || ny >= boardGrid.length
                        || visited[ny][nx]
                    ) {
                        continue;
                    }
                    const neighbor = boardGrid[ny]?.[nx];
                    if (isFilled(neighbor) && getCellId(neighbor, nx, ny) === id) {
                        visited[ny][nx] = true;
                        stack.push({ x: nx, y: ny });
                    }
                }
            }

            components.push({
                id,
                cells,
                maxY: cells.reduce((max, cell) => Math.max(max, cell.y), -1),
            });
        }
    }

    return components;
}

function canComponentFall(boardGrid, component) {
    const ownCells = new Set(component.cells.map((cell) => positionKey(cell.x, cell.y)));
    for (const cell of component.cells) {
        const nextY = cell.y + 1;
        if (nextY >= boardGrid.length) return false;

        const occupant = boardGrid[nextY]?.[cell.x];
        if (isFilled(occupant) && !ownCells.has(positionKey(cell.x, nextY))) {
            return false;
        }
    }
    return true;
}

function moveComponentDown(boardGrid, component) {
    for (const cell of component.cells) {
        boardGrid[cell.y][cell.x] = null;
    }

    const movedCells = [];
    const nextCells = [];
    for (const cell of component.cells) {
        const nextY = cell.y + 1;
        boardGrid[nextY][cell.x] = cell.cell;
        const nextCell = {
            ...cell,
            y: nextY,
        };
        nextCells.push(nextCell);
        movedCells.push({ x: nextCell.x, y: nextCell.y });
    }
    component.cells = nextCells;
    component.maxY++;

    return movedCells;
}

function applyComponentGravity(boardGrid) {
    let anyMoved = true;
    const movedCells = [];
    const components = findComponents(boardGrid)
        .sort((a, b) => b.maxY - a.maxY);

    while (anyMoved) {
        anyMoved = false;
        for (const component of components) {
            if (!canComponentFall(boardGrid, component)) continue;
            movedCells.push(...moveComponentDown(boardGrid, component));
            anyMoved = true;
        }
    }

    return movedCells;
}

function countSourceCellsInLines(sourceCells, fullLines) {
    const lineSet = new Set(fullLines);
    let count = 0;
    for (const cell of sourceCells) {
        if (lineSet.has(cell.y)) count++;
    }
    return count;
}

function addPieceToGrid(boardGrid, placement) {
    const shape = placement.shape || [];
    const id = placement.simulationId || `bot:${placement.shapeKey || 'piece'}`;
    const cells = [];

    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] <= 0) continue;

            const boardX = placement.x + x;
            const boardY = placement.y + y;
            if (boardX < 0 || boardX >= COLS || boardY < 0 || boardY >= boardGrid.length) {
                return null;
            }
            if (isFilled(boardGrid[boardY]?.[boardX])) {
                return null;
            }

            const cell = makeCell(id, placement.shapeKey || placement.type || 'BOT');
            boardGrid[boardY][boardX] = cell;
            cells.push({ x: boardX, y: boardY });
        }
    }

    return cells;
}

function scoreCascadeWave(lineCount, waveIndex) {
    if (lineCount <= 0 || waveIndex <= 0) return 0;

    const linePower = (lineCount * lineCount * 8) + (lineCount * 4);
    const chainPower = waveIndex === 1
        ? 1
        : 1 + ((waveIndex - 1) * 1.35) + (((waveIndex - 1) ** 2) * 0.45);

    return linePower * chainPower;
}

function resolveCascadeAfterstate(boardGrid, sourceCells, state) {
    if (state.cascadeCount >= state.maxCascadeLoops) {
        return state;
    }

    const fullLines = detectFullLines(boardGrid);
    if (fullLines.length === 0) {
        return state;
    }

    const waveIndex = state.cascadeCount + 1;
    const sourceCellCount = countSourceCellsInLines(sourceCells, fullLines);
    const waveScore = scoreCascadeWave(fullLines.length, waveIndex);

    state.erodedPieceCells += fullLines.length * sourceCellCount;
    state.totalLines += fullLines.length;
    state.cascadeCount = waveIndex;
    state.cascadeLineScore += waveScore;
    state.cascadeWeightedLines += fullLines.length * waveIndex;
    state.maxWaveLines = Math.max(state.maxWaveLines, fullLines.length);
    state.waves.push({
        lineCount: fullLines.length,
        lines: fullLines.slice(),
        score: waveScore,
        sourceCellCount,
        waveIndex,
    });

    for (const y of fullLines) {
        for (let x = 0; x < COLS; x++) {
            boardGrid[y][x] = null;
        }
    }

    const fallingCells = applyComponentGravity(boardGrid);
    return resolveCascadeAfterstate(boardGrid, fallingCells, state);
}

/**
 * Outgoing garbage a cascade would send, using the live Quadra attack formula
 * (see calculateGarbage in garbage.js): base = depth - 1, plus a clean bonus of
 * floor((1 + depth) / 2) when the board is fully cleared. This is the real
 * competitive objective the planner should optimize, so it is computed here
 * once and surfaced on every simulation result.
 */
export function computeProjectedAttack(totalLines, perfectClear) {
    if (totalLines <= 0) return 0;
    const base = Math.max(0, totalLines - 1);
    const cleanBonus = perfectClear ? Math.floor((1 + totalLines) / 2) : 0;
    return base + cleanBonus;
}

export function computeLandingHeight(piece, boardHeight = ROWS + HIDDEN_ROWS) {
    let minY = Infinity;
    let maxY = -Infinity;
    const shape = piece.shape || [];

    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (shape[y][x] <= 0) continue;
            minY = Math.min(minY, piece.y + y);
            maxY = Math.max(maxY, piece.y + y);
        }
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return 0;
    return boardHeight - ((minY + maxY + 1) / 2);
}

export function simulatePlacement(gameState, placement, options = {}) {
    const boardGrid = cloneGridOrEmpty(gameState?.boardGrid || gameState?.board);
    const maxCascadeLoops = options.maxCascadeLoops || 16;
    const lockFootprint = addPieceToGrid(boardGrid, placement);

    if (!lockFootprint) return null;

    const cascadeState = resolveCascadeAfterstate(boardGrid, lockFootprint, {
        cascadeCount: 0,
        cascadeLineScore: 0,
        cascadeWeightedLines: 0,
        erodedPieceCells: 0,
        maxCascadeLoops,
        maxWaveLines: 0,
        totalLines: 0,
        waves: [],
    });

    return {
        boardGrid,
        cascadeCount: cascadeState.cascadeCount,
        cascadeLineScore: cascadeState.cascadeLineScore,
        cascadeWeightedLines: cascadeState.cascadeWeightedLines,
        erodedPieceCells: cascadeState.erodedPieceCells,
        landingHeight: computeLandingHeight(placement, boardGrid.length),
        maxWaveLines: cascadeState.maxWaveLines,
        perfectClear: countFilledCells(boardGrid) === 0,
        pieceCells: lockFootprint,
        projectedAttack: computeProjectedAttack(
            cascadeState.totalLines,
            countFilledCells(boardGrid) === 0,
        ),
        totalLines: cascadeState.totalLines,
        waves: cascadeState.waves,
    };
}

/**
 * Simulate filling a set of arbitrary empty cells (e.g. the missing cells of a
 * near-full row) and resolving the full cascade. Used by the latent-chain
 * "complete the low row" trigger probe — the canonical Quadra "build-tall, fire-low"
 * machine where clearing a low row drops a stacked payload into a chain.
 * Each filler cell is its own id (it clears immediately when the row completes,
 * so connectivity is irrelevant). Returns null if any target cell is invalid/occupied.
 */
export function simulateCellFill(gameState, cells, options = {}) {
    const boardGrid = cloneGridOrEmpty(gameState?.boardGrid || gameState?.board);
    const maxCascadeLoops = options.maxCascadeLoops || 16;
    const footprint = [];

    for (const { x, y } of cells) {
        if (x < 0 || x >= COLS || y < 0 || y >= boardGrid.length) return null;
        if (isFilled(boardGrid[y][x])) return null;
        boardGrid[y][x] = makeCell(`latentfill:${x}:${y}`, 'X');
        footprint.push({ x, y });
    }
    if (footprint.length === 0) return null;

    const cascadeState = resolveCascadeAfterstate(boardGrid, footprint, {
        cascadeCount: 0,
        cascadeLineScore: 0,
        cascadeWeightedLines: 0,
        erodedPieceCells: 0,
        maxCascadeLoops,
        maxWaveLines: 0,
        totalLines: 0,
        waves: [],
    });

    const perfectClear = countFilledCells(boardGrid) === 0;
    return {
        boardGrid,
        cascadeCount: cascadeState.cascadeCount,
        maxWaveLines: cascadeState.maxWaveLines,
        perfectClear,
        projectedAttack: computeProjectedAttack(cascadeState.totalLines, perfectClear),
        totalLines: cascadeState.totalLines,
        waves: cascadeState.waves,
    };
}
