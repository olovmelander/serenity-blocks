import { COLS, HIDDEN_ROWS } from '../constants.js';
import { simulatePlacement, simulateCellFill, computeProjectedAttack } from './cascade-simulator.js';

// Vertical I-piece — the canonical trigger/payload piece for a side-cascade well.
const VERTICAL_I = [[1], [1], [1], [1]];

// Row-completion trigger probe budget: a row missing > MAX_ROW_GAP cells can't be a
// one-piece trigger; probe at most the lowest MAX_ROW_PROBES near-full rows.
const MAX_ROW_GAP = 3;
const MAX_ROW_PROBES = 2;

function isFilled(cell) {
    return cell !== null && cell !== undefined;
}

/**
 * Topmost filled row in a column, or board height if the column is empty.
 */
function firstFilledRow(boardGrid, column) {
    const height = boardGrid?.length || 0;
    for (let y = 0; y < height; y++) {
        if (isFilled(boardGrid[y]?.[column])) return y;
    }
    return height;
}

/**
 * Where a vertical I would come to rest if dropped straight down a column.
 * Returns the TOP y of the 4-cell piece, or null if it cannot fit (column too
 * full near the ceiling — i.e. the well is capped/blocked, which means dropping
 * into it would NOT fire the machine, exactly the case we want to score as zero).
 */
function verticalLandingTop(boardGrid, column) {
    const top = firstFilledRow(boardGrid, column) - VERTICAL_I.length;
    if (top < 0) return null;
    return top;
}

const EMPTY_DISCHARGE = Object.freeze({
    latentDepth: 0,
    latentComplexity: 0,
    latentPerfectClear: false,
    latentAttack: 0,
    hasTrigger: false,
});

/**
 * Estimate the latent (unrealized) cascade an in-progress machine could fire —
 * the Puyo "chain detection" / hypothetical-trigger technique. Rather than
 * scoring a partial machine only by its static surface, we simulate dropping a
 * trigger piece into each ready side-well and measure the discharge it WOULD
 * produce. This is what lets the evaluator value a built-but-unfired machine
 * above flat board damage with the same surface metrics.
 *
 * Bounded cost: only lanes the analyzer already marks platformReady /
 * payloadLoaded / triggerReady are probed, and each probe is one cheap
 * simulatePlacement on a cloned board.
 *
 * @param {Array<Array>} boardGrid - candidate board (current piece already placed)
 * @param {Array<Object>} sideLanes - lanes from analyzeSideCascade()
 * @param {string[]} nextShapeKeys - upcoming pieces (for trigger availability)
 * @returns {{latentDepth:number, latentComplexity:number, latentPerfectClear:boolean, latentAttack:number, hasTrigger:boolean}}
 */
/**
 * Trigger A — drop a vertical I into an open edge WELL (the empty-well machine).
 */
function probeWellDrop(boardGrid, readyLanes) {
    let best = null;
    for (const lane of readyLanes) {
        const column = lane.edgeColumn;
        if (column < 0 || column >= COLS) continue;
        const top = verticalLandingTop(boardGrid, column);
        if (top === null) continue;
        const sim = simulatePlacement({ boardGrid }, {
            shape: VERTICAL_I,
            shapeKey: 'I',
            type: 'I',
            simulationId: 'latent:trigger',
            x: column,
            y: top,
        });
        if (sim && sim.totalLines > 0 && (!best || sim.totalLines > best.totalLines)) best = sim;
    }
    return best;
}

/**
 * Trigger B — complete the lowest near-full row (the "build-tall, fire-low" machine
 * in the screenshot: a stacked I-payload over a near-full field cascades when a low
 * row clears). Probes the lowest few rows missing 1..MAX_ROW_GAP cells.
 */
function probeRowCompletion(boardGrid) {
    let best = null;
    let probed = 0;
    for (let y = boardGrid.length - 1; y >= HIDDEN_ROWS && probed < MAX_ROW_PROBES; y -= 1) {
        const missing = [];
        for (let x = 0; x < COLS; x += 1) {
            if (!isFilled(boardGrid[y]?.[x])) missing.push(x);
        }
        if (missing.length === 0 || missing.length > MAX_ROW_GAP) continue;
        // Only count a row as a trigger if every gap is REACHABLE from the top
        // (no filled cell above it in its column). This excludes sealed/capped
        // gaps — otherwise we'd "complete" an unreachable well and re-validate a
        // sealed trap (a machine that can't actually be fired).
        const reachable = missing.every((x) => firstFilledRow(boardGrid, x) >= y);
        if (!reachable) continue;
        probed += 1;
        const sim = simulateCellFill({ boardGrid }, missing.map((x) => ({ x, y })));
        if (sim && sim.totalLines > 0 && (!best || sim.totalLines > best.totalLines)) best = sim;
    }
    return best;
}

export function estimateLatentDischarge(boardGrid, sideLanes = [], nextShapeKeys = []) {
    if (!boardGrid) return EMPTY_DISCHARGE;

    // Probe lanes that are a built machine (platform/payload/trigger ready) OR an
    // open I-well with full-except-edge rows beneath it.
    const readyLanes = (sideLanes || []).filter(
        (lane) => lane && (
            lane.platformReady
            || lane.payloadLoaded
            || lane.triggerReady
            || (lane.triggerRows || 0) > 0
        ),
    );

    const wellBest = readyLanes.length > 0 ? probeWellDrop(boardGrid, readyLanes) : null;
    const rowBest = probeRowCompletion(boardGrid);

    let best = wellBest;
    let fromRowFill = false;
    if (rowBest && (!best || rowBest.totalLines > best.totalLines)) {
        best = rowBest;
        fromRowFill = true;
    }

    if (!best) return { ...EMPTY_DISCHARGE, hasTrigger: nextShapeKeys.includes('I') };

    // A row-completion trigger needs only 1-3 cells, so almost any piece can fire it
    // (trigger effectively in hand); a well-drop trigger needs an I in the queue.
    const hasTrigger = fromRowFill ? true : nextShapeKeys.includes('I');

    return {
        latentDepth: best.totalLines,
        latentComplexity: best.cascadeCount,
        latentPerfectClear: Boolean(best.perfectClear),
        latentAttack: best.projectedAttack
            ?? computeProjectedAttack(best.totalLines, best.perfectClear),
        hasTrigger,
    };
}
