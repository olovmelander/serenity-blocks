/** Structural setup preferences and necessary inventory bounds; never a prepared-board witness. */
import { COLS, HIDDEN_ROWS } from '../../src/core/constants.js';
import { measureBoard, analyzeCascadePreparation } from '../../src/core/ai/board-evaluator.js';
import { calculateLineClearScore } from '../../src/core/scoring.js';

export const MASTERY_SETUP_STRATEGIES = Object.freeze(['none', 'structural-v1']);

/**
 * At a drained standard-board boundary, every clear-eligible row has an empty cell.
 * A tetromino supplies at most four more cells. Off-grid cells cannot enter a later
 * wave: both physics paths rebuild in-grid connected components before gravity.
 * This is an inventory bound, not a statement that the remaining geometry is reachable.
 */
export function drainedTerminalInventoryBound({
    boardRows = 24, hiddenRows = HIDDEN_ROWS, columns = COLS, chainDepth = 8, totalQuads = 12,
} = {}) {
    if (![boardRows, hiddenRows, columns, chainDepth, totalQuads].every(Number.isSafeInteger)
        || boardRows <= hiddenRows || hiddenRows < 0 || columns < 2 || chainDepth < 1 || totalQuads < 0) {
        throw new RangeError('Inventory bound requires integer board dimensions, positive depth and nonnegative Quads');
    }
    const preLockMaximumCells = hiddenRows * columns + (boardRows - hiddenRows) * (columns - 1);
    const terminalMaximumCells = Math.min(boardRows * columns, preLockMaximumCells + 4);
    const maximumTerminalLines = Math.floor(terminalMaximumCells / columns);
    // q Quad waves require max(depth,q)+3q lines because the depth condition is a lower bound.
    const maximumTerminalQuads = Math.max(0, Math.min(
        Math.floor(maximumTerminalLines / 4),
        Math.floor((maximumTerminalLines - chainDepth) / 3),
    ));
    const minimumPriorQuads = Math.max(0, totalQuads - maximumTerminalQuads);
    const minimumTerminalQuads = Math.min(totalQuads, maximumTerminalQuads);
    const minimumTotalLines = Math.max(chainDepth, minimumTerminalQuads)
        + 3 * minimumTerminalQuads + 4 * minimumPriorQuads;
    return {
        preLockMaximumCells,
        terminalMaximumCells,
        maximumTerminalLines,
        maximumTerminalQuads,
        depthFitsInventory: maximumTerminalLines >= chainDepth,
        minimumPriorQuads,
        minimumTotalLines,
        minimumPiecesFromEmpty: Math.ceil((minimumTotalLines * columns) / 4),
        assumptions: [
            'Fixed standard board, fully drained before each lock; no inserted cells.',
            'Rows at or below hiddenRows are clear-eligible; preceding clear loop leaves each incomplete.',
            'Every placement contains exactly four cells.',
            'Off-grid cells are absent from rebuilt components before post-clear gravity.',
            'Required deep chain is terminal; Orb 49 depth eight alone exceeds its primary score target.',
        ],
        interpretation: 'Necessary inventory relaxation only; neither legal construction nor timing is demonstrated.',
    };
}

/** Optimistic score/inventory routes. A surviving route is not evidence of reachable tetromino geometry. */
export function orb49InventoryRoutes(node, { minimumFutureLockBonus = 0 } = {}) {
    const bounds = drainedTerminalInventoryBound();
    const currentQuads = node.metrics.tetrises || 0;
    const currentCells = node.lockedPieces
        ? node.lockedPieces.reduce((sum, piece) => sum + piece.shape.flat().filter(Boolean).length, 0)
        : node.boardGrid.flat().filter(Boolean).length;
    const routes = [];
    for (let priorQuads = Math.max(currentQuads, bounds.minimumPriorQuads); priorQuads <= 12; priorQuads++) {
        const additionalPriorQuads = priorQuads - currentQuads;
        const minimumFinalQuads = Math.max(0, 12 - priorQuads);
        const terminalLines = Math.max(8, minimumFinalQuads) + 3 * minimumFinalQuads;
        const requiredCells = additionalPriorQuads * 40 + terminalLines * COLS;
        const inventoryLocks = Math.ceil((requiredCells - currentCells) / 4);
        const minimumFutureLocks = Math.max(additionalPriorQuads ? 2 : 1, inventoryLocks);
        let { level } = node.context;
        let { linesUntilNextLevel } = node.context;
        let minimumQuadScore = 0;
        for (let quad = 0; quad < additionalPriorQuads; quad++) {
            linesUntilNextLevel -= 4;
            if (linesUntilNextLevel <= 0 && !node.context.disableLevelProgression) {
                level++;
                linesUntilNextLevel += 15;
            }
            minimumQuadScore += calculateLineClearScore(4, level, 1, false);
        }
        const minimumPreterminalScore = node.metrics.score + minimumQuadScore
            + minimumFutureLockBonus * (minimumFutureLocks - 1);
        routes.push({
            priorQuads,
            minimumFinalQuads,
            terminalLines,
            minimumFutureLocks,
            minimumQuadScore,
            minimumPreterminalScore,
            strictScoreHeadroom: 36000 - minimumPreterminalScore,
            scoreRelaxationSurvives: minimumPreterminalScore < 36000,
        });
    }
    return {
        minimumFutureLockBonus,
        routes,
        minimumPreterminalScore: Math.min(Infinity, ...routes.map((route) => route.minimumPreterminalScore)),
        assumptions: 'Orb 49 authored scoring/progression; required depth-eight chain is terminal; no added cells.',
        interpretation: 'Additional final Quads remain possible if inventory permits; these are minimum final Quads.',
    };
}

/** Count the actual open shaft and nine-column payload; no hypothetical trigger cells are inserted. */
export function measureQuadWell(boardGrid, wellColumn = COLS - 1) {
    const board = measureBoard(boardGrid, { hiddenRows: HIDDEN_ROWS });
    let wellCells = 0;
    let readyRows = 0;
    let longestReadyRun = 0;
    let run = 0;
    let outsideCells = 0;
    for (const row of boardGrid) {
        if (row[wellColumn]) wellCells++;
        outsideCells += row.filter((cell, x) => x !== wellColumn && cell).length;
        if (!row[wellColumn] && row.every((cell, x) => x === wellColumn || cell)) {
            readyRows++;
            run++;
            longestReadyRun = Math.max(longestReadyRun, run);
        } else run = 0;
    }
    const heights = board.heights.filter((_, x) => x !== wellColumn);
    const outsideBumpiness = heights.slice(1).reduce((sum, height, x) => sum + Math.abs(height - heights[x]), 0);
    const outsideHoles = board.holes - board.holesByColumn[wellColumn];
    return {
        wellColumn, wellCells, readyRows, longestReadyRun, outsideCells, outsideBumpiness, outsideHoles,
    };
}

/** Freeze one setup objective for this observation's receding horizon; no seed or hidden queue is accepted. */
export function createMasteryGeometryObjective(observation) {
    const { metrics, rules } = observation;
    const conditions = rules.stars.three || {};
    const chainDepth = Math.max(conditions.combo || 0, conditions.maxCombo || 0, conditions.maxCascadeDepth || 0);
    const alreadyBuiltDepth = Math.max(metrics.maxCombo || 0, metrics.maxCascadeDepth || 0);
    const special49 = rules.levelId === 49 && !observation.context.isInfinityMode;
    const inventory = special49 ? drainedTerminalInventoryBound({
        boardRows: observation.boardGrid.length, chainDepth, totalQuads: conditions.tetrises || 0,
    }) : null;
    const priorQuadTarget = inventory?.minimumPriorQuads || 0;
    const wellOptions = [0, COLS - 1].map((well) => measureQuadWell(observation.boardGrid, well));
    wellOptions.sort((a, b) => a.wellCells - b.wellCells || a.outsideHoles - b.outsideHoles
        || a.outsideBumpiness - b.outsideBumpiness || b.wellColumn - a.wellColumn);
    let phase = alreadyBuiltDepth < chainDepth ? 'chain-storage' : 'sequence-collection';
    if (special49 && (metrics.tetrises || 0) < priorQuadTarget) phase = 'quad-prefix';
    // Showcase depth goals grow in bounded stages. Reaching a stage is a heuristic milestone,
    // never fulfillment of the authored depth requirement.
    const buildDepth = special49 ? chainDepth : Math.min(chainDepth, Math.max(6, alreadyBuiltDepth + 2));
    const terminalQuadsNeeded = special49
        ? Math.max(0, (conditions.tetrises || 0) - Math.max(priorQuadTarget, metrics.tetrises || 0)) : 0;
    return {
        strategy: 'structural-v1',
        levelId: rules.levelId,
        phase,
        priorQuadTarget,
        wellColumn: wellOptions[0].wellColumn,
        chainDepth,
        buildDepth,
        minimumStoredCells: COLS * (buildDepth + 3 * terminalQuadsNeeded),
        targetCascades: conditions.cascades || 0,
        targetScore: conditions.score || 0,
        originMetrics: { ...metrics },
        inventory,
        softPreferencesOnly: true,
    };
}

/** Score real projected boards. Preparation does not qualify a chain until actual physics executes it. */
export function masteryGeometryUtility(node, objective, previews = []) {
    const board = measureBoard(node.boardGrid, { hiddenRows: node.context.isInfinityMode ? 0 : HIDDEN_ROWS });
    const addedQuads = (node.metrics.tetrises || 0) - (objective.originMetrics.tetrises || 0);
    const addedLines = (node.metrics.lines || 0) - (objective.originMetrics.lines || 0);
    const addedCascades = (node.metrics.cascades || 0) - (objective.originMetrics.cascades || 0);
    const depth = Math.max(node.metrics.maxCombo || 0, node.metrics.maxCascadeDepth || 0);
    const danger = board.safeStackMargin < 5;
    if (objective.phase === 'quad-prefix') {
        const well = measureQuadWell(node.boardGrid, objective.wellColumn);
        const incidentalLines = Math.max(0, addedLines - 4 * addedQuads);
        // Even the zero-lock-bonus relaxation catches score wasted on early perfect clears.
        // Keep this a preference: timed plans and predicted geometry are independently executed.
        const routes = orb49InventoryRoutes(node);
        const headroomPenalty = Math.max(0, routes.minimumPreterminalScore - 35999) * 12;
        return addedQuads * 15000 - incidentalLines * (danger ? 500 : 3500)
            + Math.min(8, well.readyRows) * 85 + Math.min(4, well.longestReadyRun) * 120
            - well.wellCells * 150 - well.outsideHoles * 160 - well.outsideBumpiness * 8
            - board.aggregateHeight * 0.8 - board.maxHeight * 5 - board.topOutRisk * 2500
            - board.ceilingPressure * 4 - node.pathCost * 0.8 - headroomPenalty;
    }
    const preparation = analyzeCascadePreparation(node.boardGrid, previews, {
        hiddenRows: node.context.isInfinityMode ? 0 : HIDDEN_ROWS,
    });
    const cells = node.boardGrid.flat().filter(Boolean).length;
    let score = preparation.preparationScore * 18 - board.holes * 8 - board.bumpiness * 2
        - board.maxHeight * 2 - board.topOutRisk * 2500 - board.ceilingPressure * 5 - node.pathCost * 0.4;
    if (objective.phase === 'chain-storage') {
        const stored = Math.min(cells, objective.minimumStoredCells);
        const depthRatio = Math.min(1, depth / Math.max(1, objective.buildDepth));
        score += stored * 18 + depthRatio ** 3 * 20000;
        // Spending the material on an under-target discharge is costly while there is room to build.
        if (depth < objective.buildDepth && !danger) score -= addedCascades * 7000 + addedLines * 220;
        if (depth >= objective.buildDepth) score += 18000;
        if (objective.levelId === 49) score += addedQuads * 8000;
    } else {
        score += addedCascades * 7000 + addedLines * 20;
        score += Math.min(1, (node.metrics.score || 0) / Math.max(1, objective.targetScore)) * 3000;
    }
    return score;
}
