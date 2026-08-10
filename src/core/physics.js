/**
 * @fileoverview Physics and line clearing system for Serenity Blocks
 * Handles multi-phase physics processing including line detection, clearing,
 * gravity application, and cascade checking.
 */

import {
    COLS, ROWS, HIDDEN_ROWS, LEVEL_SPEEDS, COLORS,
} from './constants.js';
import {
    cloneBoardGrid, rebuildBoardGridFromPieces, updatePiecePositionInGrid, markBoardDirty,
} from './board.js';
import { calculateLineClearScore } from './scoring.js';
import {
    isPartOfPiece, findConnectedComponents, detectFullLines, removeClearedLines,
} from './cascade-helpers.js';
import { resolveCascade } from './cascade-resolver.js';
import { readFlag } from './flags.js';

// Shared cascade primitives moved to cascade-helpers.js (plan §5.2 — one
// implementation for both the legacy loop and the pure resolver, no cycle).
// Re-exported here for existing consumers.
export {
    isPartOfPiece, findConnectedComponents, detectFullLines, removeClearedLines,
};

const PHYSICS_DEBUG = false;
const physicsLog = (...args) => {
    if (PHYSICS_DEBUG) console.log(...args);
};
const physicsWarn = (...args) => {
    if (PHYSICS_DEBUG) console.warn(...args);
};

const perfNow = typeof performance !== 'undefined' && performance?.now
    ? () => performance.now()
    : () => Date.now();

/**
 * Longest stretch of owed animation the pacer will compress into a single
 * catch-up burst before it starts waiting again.
 *
 * Without a bound, a machine that is persistently slower than the nominal
 * timeline would let every remaining step resolve instantly and the whole
 * cascade would snap. A competitive player still has to *read* which rows
 * cleared, so we cap how much can vanish at once and re-anchor the timeline.
 */
const MAX_ANIMATION_CATCHUP_MS = 120;

/**
 * Cascade gravity: milliseconds per row of fall.
 *
 * Ported from Quadra (source/player.cc, `Player_check_link::step`). Quadra runs
 * a fixed 10ms simulation tick (`while (acc >= 10) { acc -= 10; overmind.step(); }`
 * in quadra.cc's main_loop) and its cascade alternates two steps per row — one
 * step flood-fills block connectivity, the next moves every unsupported block
 * down exactly one row. That is 2 x 10ms = 20ms per row, constant, with no
 * acceleration and no easing.
 *
 * We were at 16ms (62.5 rows/sec), which read as frantic. Note the previous
 * frame-quantised implementation accidentally landed near this value — an
 * 18-row cascade measured 552ms against Quadra's 520ms — which is why it felt
 * right before the pacer started hitting the authored constants exactly.
 *
 * See docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md §8.
 */
const GRAVITY_STEP_MS = 20;

/**
 * How long the completed rows stay on screen before the stack collapses.
 *
 * Quadra's `Player_flash_lines` (source/player.cc:738) holds for 16 ticks =
 * 160ms, strobing a solid bar across each cleared row, then cuts to the fall.
 *
 * We already draw that bar: `triggerLineClearFlash`
 * (rendering/phaser/shared-effects.js:262) adds a full-width additive stripe per
 * cleared row and tweens it out over `220 + index * 40`ms. The effect was never
 * the problem — the board collapsed out from under it after only 70ms. Holding
 * 160ms lets the stripe read before the rows vanish.
 *
 * NOTE: the per-cell `alpha` fade this hold used to run was dead code. It wrote
 * onto the `cloneBoardGrid` scratch that only `callbacks.updateBoard` sees, and
 * every definition of that callback is an empty no-op (main.js:3390, :4633),
 * while the renderer draws from `gameState.boardGrid`
 * (rendering/phaser/base-board-scene.js:814). Do not reintroduce a per-cell
 * flash without first giving the renderer a way to read it.
 */
const LINE_CLEAR_HOLD_MS = 160;

/**
 * Beat between the rows disappearing and the stack starting to fall.
 *
 * Quadra gets this for free: `Player_check_link`'s first tick only flood-fills
 * connectivity (`fill_bloc`) and moves nothing, so there is a full 10ms tick
 * where the row is gone and the stack still hangs. That beat is what makes the
 * collapse read as a consequence rather than a jump-cut.
 *
 * We had no equivalent — nothing repainted between `removeClearedLines` and the
 * first gravity step, so the first frame after the hold already had everything
 * moved down a row. Cause and effect landed on the same frame.
 */
const SETTLE_LEAD_MS = 20;

/**
 * Beat after the last block lands, before the next wave or the next piece.
 * Mirrors Quadra's final `Player_check_link` pass, whose move step moves nothing
 * before `ret()` — the collapse gets a moment to land.
 */
const SETTLE_TAIL_MS = 20;

/**
 * Hold the completed rows on screen while the clear stripe plays.
 * Shared by the legacy and resolved paths so the two cannot drift — the §5.10
 * differential gate compares them.
 *
 * @param {Array<Array<Object|null>>} markedBoard scratch clone for updateBoard
 * @param {number} speedClass per-wave multiplier (1.0 / 0.8 / 0.6 / 0.5)
 * @param {Object} callbacks physics callbacks (updateBoard / draw)
 * @param {{wait:(ms:number)=>Promise<boolean>}} pacer shared animation timeline
 */
async function holdClearedRows(markedBoard, speedClass, callbacks, pacer) {
    if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
    if (callbacks.draw) callbacks.draw();
    await pacer.wait(LINE_CLEAR_HOLD_MS * speedClass);
}

/**
 * The "rows are gone, nothing has moved yet" beat. Must run AFTER the cleared
 * rows are removed from the board and BEFORE the first gravity step, and must
 * repaint — `markBoardDirty` is what makes the static layer redraw.
 *
 * @param {Object} gameState
 * @param {number} speedClass per-wave multiplier
 * @param {Object} callbacks physics callbacks
 * @param {{wait:(ms:number)=>Promise<boolean>}} pacer shared animation timeline
 */
async function settleLead(gameState, speedClass, callbacks, pacer) {
    markBoardDirty(gameState);
    if (callbacks.draw) callbacks.draw();
    await pacer.wait(SETTLE_LEAD_MS * speedClass);
}

/** Resolve once the wall clock reaches `deadlineMs`. */
function waitUntil(deadlineMs) {
    const raf = typeof window !== 'undefined' ? window.requestAnimationFrame : null;

    if (!raf) {
        return new Promise((resolve) => setTimeout(resolve, Math.max(0, deadlineMs - perfNow())));
    }

    return new Promise((resolve) => {
        const tick = () => {
            if (perfNow() >= deadlineMs) resolve();
            else raf(tick);
        };
        raf(tick);
    });
}

/**
 * Wall-clock pacer for the line-clear / cascade animation.
 *
 * The old scheme awaited `durationMs` per step against a fresh `performance.now()`
 * baseline, so every step cost at least one whole frame and any overshoot was
 * discarded. Real cost was therefore `ceil(d / frameTime) * frameTime` per step:
 * with the 16ms-per-row gravity loop, a 72ms frame turned a 10-row cascade from
 * 267ms into 936ms, and a 108ms frame into 1.4s. That is what "the cascades fall
 * and clear in a slow and laggy way" actually was — the animation multiplied the
 * frame-time tail instead of absorbing it.
 *
 * A pacer keeps ONE timeline for the whole sequence (all flash stages, every
 * gravity row, across cascade waves) and gives each step an absolute deadline.
 * When a long frame has already carried the clock past the next deadline the
 * wait returns without yielding, so the sequence catches up inside that frame
 * rather than spending another one on a single row. Total wall-clock duration
 * stays ~nominal at any frame rate; degradation shows up as fewer intermediate
 * frames drawn, not as a slower cascade.
 *
 * See docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md §3.
 *
 * @param {Object} gameState
 * @returns {{wait: (durationMs: number) => Promise<boolean>}}
 */
function createAnimationPacer(gameState) {
    let anchor = perfNow();
    let scheduledMs = 0;

    return {
        /**
         * Consume `durationMs` of the animation timeline.
         * @returns {Promise<boolean>} true when it actually yielded a frame,
         *   false when the clock had already run past this step.
         */
        async wait(durationMs) {
            advanceReplaySimulationClock(gameState, durationMs);
            if (gameState?.isSeeking) return false;

            scheduledMs += Math.max(0, Number(durationMs) || 0);
            const deadline = anchor + scheduledMs;
            const lateness = perfNow() - deadline;

            if (lateness >= 0) {
                // Behind schedule: catch up now instead of burning another frame.
                // Re-anchor so persistent slowness cannot compound into a snap.
                if (lateness > MAX_ANIMATION_CATCHUP_MS) {
                    anchor += lateness - MAX_ANIMATION_CATCHUP_MS;
                }
                return false;
            }

            await waitUntil(deadline);
            return true;
        },
    };
}

function advanceReplaySimulationClock(gameState, durationMs) {
    if (!gameState?.isReplay) return;

    const delay = Math.max(0, Number(durationMs) || 0);
    if (delay <= 0) return;

    const currentSimTime = Number.isFinite(gameState.simTimeMs)
        ? gameState.simTimeMs
        : (Number.isFinite(gameState.lastTime) ? gameState.lastTime : 0);
    gameState.simTimeMs = currentSimTime + delay;
    gameState.lastTime = gameState.simTimeMs;

    const tickMs = Number(gameState.simTickMs) || (1000 / 60);
    gameState.simFrame = Math.max(0, Math.round(gameState.simTimeMs / tickMs));

    if (gameState.hitStopRemaining > 0) {
        gameState.hitStopRemaining = Math.max(0, gameState.hitStopRemaining - delay);
    }
}

/**
 * Pacer for callers that animate a single step outside a larger sequence.
 * Sequences (clear → gravity → next wave) must share ONE pacer so overshoot
 * carries across steps — see createAnimationPacer.
 */
function resolvePacer(gameState, pacer) {
    return pacer || createAnimationPacer(gameState);
}

/* moved to cascade-helpers.js: isPartOfPiece */

/* moved to cascade-helpers.js: findConnectedComponents */

/**
 * Applies gravity to blocks after line clears, making them fall independently
 * Uses smooth animation with variable speed based on fall distance
 * PERFORMANCE OPTIMIZED: Uses incremental grid updates instead of full rebuilds
 * @param {Array<Object>} lockedPieces - Array of locked pieces (modified in place)
 * @param {Function} drawCallback - Function to call for visual updates
 * @param {Array<Array<boolean>>} placementGrid - 2D array to track which cells moved (optional)
 * @param {{wait: (ms:number)=>Promise<boolean>}} [pacer] - shared animation
 *   timeline from the enclosing clear sequence; a private one is created when
 *   gravity is driven standalone.
 * @returns {Promise<void>} Resolves when all blocks have settled
 */
export async function applyGravity(
    gameState,
    drawCallback,
    placementGrid = null,
    callbacks = {},
    pacer = null,
) {
    const animationPacer = resolvePacer(gameState, pacer);
    const { lockedPieces, boardGrid } = gameState;
    let blocksStillFalling = true;

    // Note: Viewport optimization removed - it was causing stuck pieces
    // All pieces must be processed for gravity to work correctly
    // The performance gain wasn't worth the correctness issues
    const visiblePieces = [...lockedPieces]
        .sort((a, b) => b.y + b.shape.length - (a.y + a.shape.length));

    // PERFORMANCE: Only rebuild once at the start
    // The grid is already current from the previous physics phase
    // We'll use incremental updates during the gravity loop
    const currentBoard = boardGrid;

    // Calculate maximum potential fall distance to determine animation speed
    // For infinity mode with large grids, we need adaptive timing
    let maxPotentialFall = 0;
    visiblePieces.forEach((piece) => {
        // Check how far this piece could potentially fall
        let fallDistance = 0;
        for (let y = piece.y + piece.shape.length; y < boardGrid.length; y++) {
            let hasBlockBelow = false;
            piece.shape.forEach((row, localY) => {
                row.forEach((cell, localX) => {
                    if (cell > 0) {
                        const boardX = piece.x + localX;
                        const checkY = y + (piece.shape.length - 1 - localY);
                        if (checkY < boardGrid.length && boardGrid[checkY] && boardGrid[checkY][boardX] !== null) {
                            hasBlockBelow = true;
                        }
                    }
                });
            });
            if (hasBlockBelow) break;
            fallDistance++;
        }
        maxPotentialFall = Math.max(maxPotentialFall, fallDistance);
    });

    // Fixed gravity delay - same speed for all game modes and every cascade
    // wave, matching Quadra's constant 2-tick-per-row fall. See GRAVITY_STEP_MS.
    const gravityDelay = GRAVITY_STEP_MS;

    physicsLog(`[Gravity] Max potential fall: ${maxPotentialFall} rows, using fixed ${gravityDelay}ms per step`);

    while (blocksStillFalling) {
        blocksStillFalling = false;

        // PERFORMANCE CRITICAL: NO REBUILD HERE!
        // Grid is kept up-to-date through incremental updates below

        // Process blocks from bottom to top to prevent double-processing.
        for (const piece of visiblePieces) {
            let canFall = true;

            // Check if this entire block cluster can fall one row
            piece.shape.forEach((row, localY) => {
                row.forEach((cell, localX) => {
                    if (cell > 0) {
                        const boardX = piece.x + localX;
                        const boardY = piece.y + localY + 1; // Check one row below

                        // Check boundaries
                        if (boardY >= currentBoard.length) {
                            canFall = false;
                            return;
                        }

                        // Check if there's a block below that's NOT part of this piece
                        if (
                            currentBoard[boardY][boardX] !== null
                            && !isPartOfPiece(boardX, boardY, piece)
                        ) {
                            canFall = false;
                        }
                    }
                });
            });

            if (canFall) {
                // Mark cells as moved if tracking
                if (placementGrid) {
                    piece.shape.forEach((row, localY) => {
                        row.forEach((cell, localX) => {
                            if (cell > 0) {
                                const boardX = piece.x + localX;
                                const boardY = piece.y + localY + 1; // New position after fall
                                if (boardY < placementGrid.length && boardX < placementGrid[0].length) {
                                    placementGrid[boardY][boardX] = true;
                                }
                            }
                        });
                    });
                }

                // PERFORMANCE: Use incremental update instead of full rebuild
                const oldY = piece.y;
                piece.y++;
                updatePiecePositionInGrid(piece, oldY, boardGrid);

                blocksStillFalling = true;
            }
        }

        // Visual feedback with consistent timing
        if (blocksStillFalling) {
            // CRITICAL: Mark board dirty so the dual-canvas renderer redraws the static layer
            // Without this, the performance optimization skips redrawing falling pieces
            markBoardDirty(gameState);

            if (drawCallback) {
                drawCallback();
            }

            // Update camera to follow falling blocks during cascade
            // PERFORMANCE: Throttling will be applied in InfinityMode
            callbacks.onGravityStep?.();

            // Paced against the sequence timeline, so a long frame advances
            // several rows instead of costing a whole frame for one row.
            // eslint-disable-next-line no-await-in-loop
            const yielded = await animationPacer.wait(gravityDelay);
            if (!yielded && !gameState.isSeeking) {
                physicsLog('[Gravity] Behind schedule — catching up without yielding a frame');
            }
        }
    }

    // PERFORMANCE: Grid is already up-to-date from incremental updates
    // No need for final rebuild!
}

/* moved to cascade-helpers.js: detectFullLines */

/**
 * Calculate garbage hole columns for cascade clears (deterministic fallback)
 *
 * MOVED-ARRAY METHOD:
 * We track which cells moved (fell down) after line clears. The hole pattern
 * for garbage is determined by scanning the moved array for each cleared row.
 * A column gets a hole if moved[row][col] is true for that cleared row.
 *
 * In Serenity Blocks we prefer the pre/post board delta for cascades; this
 * helper is a deterministic fallback.
 *
 * @param {Array<Array<boolean>>} placementGrid - 2D array tracking which cells moved
 * @param {Array<number>} fullLines - Y coordinates of lines being cleared
 * @returns {Array<number>} Array of column indices for garbage holes
 */
export function calculateCascadeHoleColumns(placementGrid, fullLines) {
    if (!placementGrid || fullLines.length === 0) {
        return [Math.floor(COLS / 2)];
    }

    const highestClearedLine = Math.min(...fullLines);
    const lowestClearedLine = Math.max(...fullLines);

    physicsLog('[calculateCascadeHoleColumns] ========================================');
    physicsLog(
        `[calculateCascadeHoleColumns] moved-array method: Analyzing cleared lines [${fullLines.join(', ')}]`,
    );

    // Scan the moved array to find which columns had blocks that moved
    // We'll aggregate across all cleared lines to get the hole pattern
    const movedColumns = new Set();

    fullLines.forEach((y) => {
        if (placementGrid[y]) {
            for (let x = 0; x < COLS; x++) {
                if (placementGrid[y][x]) {
                    movedColumns.add(x);
                }
            }
        }
    });

    // Visualize the moved array for debugging
    physicsLog(
        '[calculateCascadeHoleColumns] Moved array visualization (. = not moved, X = moved):',
    );
    physicsLog(`  Columns:     ${Array.from({ length: COLS }, (_, i) => i).join('')}`);
    fullLines.slice(0, 4).forEach((y) => {
        if (placementGrid[y]) {
            const viz = Array.from({ length: COLS }, (_, x) => (placementGrid[y][x] ? 'X' : '.')).join(
                '',
            );
            physicsLog(`  Row Y=${String(y).padStart(2)}: ${viz}`);
        }
    });

    const holeColumns = Array.from(movedColumns).sort((a, b) => a - b);

    if (holeColumns.length === 0) {
        // Fallback if no movement tracked (shouldn't happen)
        const mid = Math.floor(COLS / 2);
        physicsWarn(
            `[calculateCascadeHoleColumns] WARNING: No moved columns found, using fallback [${mid}]`,
        );
        return [mid];
    }

    physicsLog(`[calculateCascadeHoleColumns] Moved columns (holes): [${holeColumns.join(', ')}]`);
    physicsLog('[calculateCascadeHoleColumns] ========================================');
    return holeColumns;
}

/**
 * Calculate garbage hole columns by comparing board states before and after gravity
 * @param {Array<Array<boolean>>} preGravityBoard - Board snapshot before gravity (true = filled)
 * @param {Array<Array<Object|null>>} currentBoard - Current board after gravity
 * @param {Array<number>} fullLines - Y coordinates of lines being cleared
 * @returns {Array<number>} Column indices where cells changed from empty to filled
 */
function calculateHoleColumnsFromBoardDelta(preGravityBoard, currentBoard, fullLines) {
    if (!preGravityBoard || fullLines.length === 0) {
        return [];
    }

    const holeColumns = new Set();

    fullLines.forEach((y) => {
        const prevRow = preGravityBoard[y];
        const currRow = currentBoard[y];
        if (!currRow) {
            return;
        }

        for (let x = 0; x < COLS; x++) {
            const wasFilled = prevRow ? prevRow[x] : false;
            const isFilled = currRow[x] !== null;
            if (!wasFilled && isFilled) {
                holeColumns.add(x);
            }
        }
    });

    return Array.from(holeColumns).sort((a, b) => a - b);
}

/**
 * Build per-row hole masks for a cascade wave.
 * Returns both the per-row masks and the merged
 * column set that older callbacks expect.
 *
 * @param {Array<number>} fullLines - Y coordinates of lines being cleared
 * @param {Object} options
 * @param {number} options.cascadeCount - Current cascade index (1 = manual clear)
 * @param {Array<Array<boolean>>} options.placementGrid - Movement tracking array
 * @param {Array<Array<boolean>>} options.preGravityBoard - Snapshot before gravity (boolean)
 * @param {Array<Array<Object|null>>} options.currentBoard - Board prior to clearing (object/null)
 * @param {Array<number>} options.manualHoleColumns - Fallback manual hole columns
 * @returns {{rowMasks: Array<Array<number>>, mergedColumns: Array<number>}}
 */
function buildHoleMaskRows(
    fullLines,
    {
        cascadeCount, placementGrid, preGravityBoard, currentBoard, manualHoleColumns,
    },
) {
    const fallback = manualHoleColumns && manualHoleColumns.length > 0
        ? manualHoleColumns
        : [Math.floor(COLS / 2)];

    const rowMasks = [];

    fullLines.forEach((y) => {
        let columns = [];

        if (cascadeCount === 1) {
            if (placementGrid && placementGrid[y]) {
                for (let x = 0; x < COLS; x++) {
                    if (placementGrid[y][x]) {
                        columns.push(x);
                    }
                }
            }
        } else {
            if (preGravityBoard && preGravityBoard[y] && currentBoard && currentBoard[y]) {
                for (let x = 0; x < COLS; x++) {
                    const wasFilled = preGravityBoard[y][x];
                    const isFilled = currentBoard[y][x] !== null;
                    if (!wasFilled && isFilled) {
                        columns.push(x);
                    }
                }
            }

            if (columns.length === 0 && placementGrid && placementGrid[y]) {
                for (let x = 0; x < COLS; x++) {
                    if (placementGrid[y][x]) {
                        columns.push(x);
                    }
                }
            }
        }

        if (columns.length === 0) {
            columns = [...fallback];
        }

        const unique = Array.from(new Set(columns)).sort((a, b) => a - b);
        rowMasks.push(unique);
    });

    const mergedSet = new Set();
    rowMasks.forEach((mask) => {
        mask.forEach((col) => mergedSet.add(col));
    });

    if (mergedSet.size === 0) {
        fallback.forEach((col) => mergedSet.add(col));
    }

    return {
        rowMasks,
        mergedColumns: Array.from(mergedSet).sort((a, b) => a - b),
    };
}

/**
 * Reset moved array tracking for the next gravity phase
 * @param {Array<Array<boolean>>} placementGrid - Movement tracking array to clear
 */
function resetMovedArray(placementGrid) {
    if (!placementGrid) return;
    for (let y = 0; y < placementGrid.length; y++) {
        placementGrid[y].fill(false);
    }
}

/**
 * Helper function to find contiguous regions in an array of column indices
 * @param {Array<number>} columns - Sorted array of column indices
 * @returns {Array<Array<number>>} Array of contiguous regions
 */
function findContiguousRegions(columns) {
    if (columns.length === 0) return [];

    const regions = [];
    let currentRegion = [columns[0]];

    for (let i = 1; i < columns.length; i++) {
        if (columns[i] === columns[i - 1] + 1) {
            // Contiguous - add to current region
            currentRegion.push(columns[i]);
        } else {
            // Gap found - start new region
            regions.push(currentRegion);
            currentRegion = [columns[i]];
        }
    }
    regions.push(currentRegion);

    return regions;
}

/**
 * Helper function to get the contiguous span from min to max of an array of columns
 * @param {Array<number>} columns - Array of column indices
 * @returns {Array<number>} Contiguous span from min to max
 */
function getContiguousSpan(columns) {
    if (columns.length === 0) return [];
    const min = Math.min(...columns);
    const max = Math.max(...columns);
    const span = [];
    for (let x = min; x <= max; x++) {
        span.push(x);
    }
    return span;
}

/* moved to cascade-helpers.js: removeClearedLines */

/**
 * Main physics processing loop
 *
 * Hole-position tracking:
 * 1. moved[row][col] is set TRUE when a piece is placed at that position
 * 2. During line clearing, moved[row][col] for cleared lines determines holes
 * 3. TRUE in moved[][] → HOLE in garbage (inverse mapping!)
 * 4. After gravity, moved[][] tracks which cells FELL to determine cascade holes
 *
 * @param {Object} gameState - Game state object containing:
 *   - lockedPieces: Array of locked pieces (modified in place)
 *   - level: Current game level
 *   - lines: Total lines cleared
 *   - linesUntilNextLevel: Lines needed for next level
 *   - score: Current score
 *   - comboState: State tracking for garbage calculation
 * @param {Object} callbacks - Callback functions
 * @returns {Promise<void>} Resolves when all physics processing is complete
 */
export async function processPhysicsLegacy(gameState, callbacks) {
    let linesClearedThisTurn = 0;
    let cascadeCount = 0;
    // One timeline for the whole clear→gravity→next-wave sequence so a stalled
    // frame is repaid across the following steps instead of stretching each one.
    const pacer = createAnimationPacer(gameState);

    const comboState = gameState.comboState || {
        manualColumns: gameState.lastPlacedPieceX || [],
        lockFootprint: [],
    };
    const manualHoleColumns = comboState.manualColumns && comboState.manualColumns.length > 0
        ? comboState.manualColumns
        : gameState.lastPlacedPieceX && gameState.lastPlacedPieceX.length > 0
            ? gameState.lastPlacedPieceX
            : [Math.floor(COLS / 2)];

    let depth = comboState.depth || 0;
    let complexity = comboState.complexity || 0;
    const holeMaskMatrix = [];
    let sendForPerfectClear = false;

    // moved[row][col] tracks piece placement positions
    // Initial state: mark where the piece was just placed
    // FIX: Use actual board length for tall boards (100+ rows)
    const boardHeight = gameState.boardGrid?.length || (ROWS + HIDDEN_ROWS);
    const placementGrid = Array.from({ length: boardHeight }, () => Array(COLS).fill(false));

    // Step 1: Mark initial piece placement (from lockFootprint)
    if (comboState.lockFootprint && comboState.lockFootprint.length > 0) {
        comboState.lockFootprint.forEach(({ x, y }) => {
            // Floor coordinates to ensure integer indexing
            const floorY = Math.floor(y);
            const floorX = Math.floor(x);
            if (floorY >= 0 && floorY < placementGrid.length && floorX >= 0 && floorX < COLS) {
                placementGrid[floorY][floorX] = true;
            }
        });
        physicsLog(
            `[Physics] Initial moved[][] tracking: ${comboState.lockFootprint.length} cells marked from placed piece`,
        );
    }

    let preGravityBoard = null;

    while (true) {
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        // Phase 1: Line detection and clearing
        const boardData = gameState.boardGrid;
        const fullLines = detectFullLines(boardData);

        if (fullLines.length === 0) {
            break; // No more lines to clear, physics are stable
        }

        if (gameState.lineClearCounts) {
            const count = fullLines.length;
            gameState.lineClearCounts[count] = (gameState.lineClearCounts[count] || 0) + 1;
        }

        cascadeCount++;

        if (cascadeCount >= 2 && callbacks.triggerCombo) {
            callbacks.triggerCombo(cascadeCount);
        }

        // Trigger cascade wave visual indicator for cascades 2+
        if (cascadeCount >= 2 && callbacks.triggerCascadeWave) {
            callbacks.triggerCascadeWave(cascadeCount);
        }

        // Store moved[][] state for each cleared line
        // This captures which cells had blocks from the current piece (cascade 1)
        // or which cells fell from above (cascades 2+)
        const waveHoleMasks = [];
        const waveHoleColumns = new Set();

        physicsLog(
            `[Physics] ===== Cascade ${cascadeCount}: Processing ${fullLines.length} cleared lines =====`,
        );
        physicsLog('[Physics] Moved[][] array state before line clear:');
        fullLines.slice(0, Math.min(4, fullLines.length)).forEach((y) => {
            const movedCols = [];
            for (let x = 0; x < COLS; x++) {
                if (placementGrid[y] && placementGrid[y][x]) {
                    movedCols.push(x);
                }
            }
            physicsLog(
                `[Physics]   Row ${y}: moved columns = [${movedCols.join(', ')}]${movedCols.length === 0 ? ' (NONE - will use fallback)' : ''}`,
            );
        });

        fullLines.forEach((y, localIndex) => {
            // Read moved[][] for this row to determine hole pattern
            const mask = Array(COLS).fill(false);

            if (placementGrid[y]) {
                for (let x = 0; x < COLS; x++) {
                    if (placementGrid[y][x]) {
                        mask[x] = true; // TRUE = hole in garbage
                    }
                }
            }

            // Fallback if no moved cells found (shouldn't happen in correct implementation)
            if (!mask.some((value) => value)) {
                physicsWarn(`[Physics]   WARNING: Row ${y} has no moved[] markers, using fallback`);
                let fallbackColumns = [];

                if (cascadeCount === 1 && manualHoleColumns.length > 0) {
                    fallbackColumns = manualHoleColumns;
                } else {
                    fallbackColumns = calculateHoleColumnsFromBoardDelta(
                        preGravityBoard,
                        boardData,
                        [y],
                    );
                }

                if (fallbackColumns.length === 0) {
                    fallbackColumns = calculateCascadeHoleColumns(placementGrid, [y]);
                }

                fallbackColumns.forEach((col) => {
                    if (col >= 0 && col < COLS) {
                        mask[col] = true;
                    }
                });
            }

            mask.forEach((flag, x) => {
                if (flag) {
                    waveHoleColumns.add(x);
                }
            });

            holeMaskMatrix.push(mask.slice());
            waveHoleMasks.push(mask.slice());
        });

        depth += fullLines.length;
        complexity += 1;

        const holeColumns = Array.from(waveHoleColumns).sort((a, b) => a - b);

        physicsLog(`[Physics] Cascade ${cascadeCount} result: ${fullLines.length} lines cleared`);
        physicsLog('[Physics] Hole masks (TRUE = hole in garbage):');
        waveHoleMasks.forEach((mask, index) => {
            const holeCols = [];
            const solidCols = [];
            mask.forEach((flag, x) => {
                if (flag) holeCols.push(x);
                else solidCols.push(x);
            });
            physicsLog(
                `[Physics]   Line ${index + 1}/${waveHoleMasks.length}: holes=[${holeCols.join(', ')}], solid=[${solidCols.join(', ')}]`,
            );
        });
        physicsLog(`[Physics] Merged hole columns: [${holeColumns.join(', ')}]`);

        // --- Line Clear Animation and Scoring ---
        linesClearedThisTurn += fullLines.length;
        const oldLevel = gameState.level;
        gameState.lines += fullLines.length;
        gameState.linesUntilNextLevel -= fullLines.length;

        // Skip level progression if disabled (e.g., Infinity mode uses fixed speed)
        if (gameState.linesUntilNextLevel <= 0 && !gameState.disableLevelProgression) {
            gameState.level++;
            gameState.linesUntilNextLevel += 15; // 15 lines per level
            gameState.dropInterval = LEVEL_SPEEDS[Math.min(gameState.level - 1, LEVEL_SPEEDS.length - 1)];
            // Odyssey speed-up modifier: keep the drop interval 1.5x shorter at every level-up so the
            // effect survives the recompute. Gated on speedMultiplier (only the Odyssey modifier sets
            // it) → shared single-player physics is byte-identical (masterplan §2 #3 / C2).
            if (gameState.speedMultiplier) {
                gameState.dropInterval /= gameState.speedMultiplier;
            }

            if (callbacks.playLevelUp) callbacks.playLevelUp();
            if (callbacks.onLevelUp) callbacks.onLevelUp(gameState.level);
        } else if (gameState.linesUntilNextLevel <= 0) {
            // Reset line counter even when level progression is disabled
            gameState.linesUntilNextLevel += 15;
        }

        if (oldLevel !== gameState.level && callbacks.updateBackground) {
            callbacks.updateBackground(gameState.level);
        }

        // Scoring: uses depth (lines), level, complexity (cascades), and perfect clear
        // Perfect clear is detected later after all cascades complete, so we pass false here
        // and add the perfect clear bonus at the end if the board is empty
        let points = calculateLineClearScore(fullLines.length, gameState.level, cascadeCount, false);
        // Odyssey combo-multiplier modifier: scale the line-clear score by the combo built up on
        // prior consecutive-clearing locks. Gated on comboMultiplierEnabled — a flag ONLY the
        // Odyssey ModifierStack sets — so shared single-player/multiplayer physics is byte-identical.
        // The multiplier is fixed per lock (maintained at end of processPhysics), so every cascade
        // wave of this lock shares it. (masterplan §2 #3 / C2)
        if (gameState.comboMultiplierEnabled && gameState.comboMultiplier > 1) {
            points = Math.round(points * gameState.comboMultiplier);
        }
        gameState.score += points;

        if (callbacks.playLineClear) callbacks.playLineClear();
        if (callbacks.onScoreAdd) callbacks.onScoreAdd(points);
        if (callbacks.onLineClear) {
            callbacks.onLineClear(
                fullLines.length,
                holeColumns,
                waveHoleMasks.map((mask) => mask.slice()),
                fullLines.slice(),
                cascadeCount,
            );
        }

        // T-spin and B2B tracking — evaluated on the manual clear (cascade 1) per lock.
        const isTSpin = cascadeCount === 1 && Boolean(gameState.comboState?.tSpin);
        const isDifficultClear = fullLines.length >= 4 || isTSpin;

        if (isTSpin && callbacks.onTSpin) {
            callbacks.onTSpin(fullLines.length);
        }
        if (isDifficultClear) {
            if (gameState.b2bActive && callbacks.onB2B) {
                callbacks.onB2B(true);
            }
            gameState.b2bActive = true;
        } else if (cascadeCount === 1) {
            // Reset B2B only on the manual clear; cascade stages don't break the chain.
            gameState.b2bActive = false;
        }

        if (callbacks.onLineClearImpact) callbacks.onLineClearImpact(fullLines.length, cascadeCount);
        if (callbacks.triggerFlash) callbacks.triggerFlash(fullLines);
        if (callbacks.triggerBackgroundPulse) callbacks.triggerBackgroundPulse(fullLines.length);

        // Clear moved[][] AFTER reading hole positions
        // This prepares it to track which cells fall during gravity
        physicsLog('[Physics] Clearing moved[][] array for gravity tracking');
        resetMovedArray(placementGrid);

        // --- Line-clear flash (Quadra rhythm — see LINE_CLEAR_FLASH_BEATS) ---
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        const markedBoard = cloneBoardGrid(gameState.boardGrid);

        // Per-wave speed class. Quadra itself has no cascade speed-up — every
        // wave gets the full 160ms hold — but deep chains are spectacle here and
        // the wave payload already carries this multiplier, so keep it: wave 1
        // is Quadra-exact at 160ms and later waves tighten.
        // Cascade 1: 1.0x (160ms) · 2-4: 0.8x (128ms) · 5-9: 0.6x (96ms) · 10+: 0.5x (80ms)
        const speedMultiplier = cascadeCount === 1 ? 1.0
            : cascadeCount <= 4 ? 0.8
                : cascadeCount <= 9 ? 0.6 : 0.5;

        // eslint-disable-next-line no-await-in-loop
        await holdClearedRows(markedBoard, speedMultiplier, callbacks, pacer);

        // --- Remove cleared lines from pieces ---
        gameState.lockedPieces = removeClearedLines(gameState.lockedPieces, fullLines);

        // Split pieces into individual blocks for independent gravity
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        gameState.lockedPieces = findConnectedComponents(gameState.boardGrid);

        // Snapshot board state before gravity so the next cascade can compare deltas
        preGravityBoard = cloneBoardGrid(gameState.boardGrid).map((row) => row.map((cell) => cell !== null));

        // Beat: rows gone, stack still hanging (Quadra's connectivity-scan tick)
        // eslint-disable-next-line no-await-in-loop
        await settleLead(gameState, speedMultiplier, callbacks, pacer);

        // Phase 2: Apply gravity to individual blocks and track movement
        // eslint-disable-next-line no-await-in-loop
        await applyGravity(gameState, callbacks.draw, placementGrid, callbacks, pacer);

        // Beat: let the collapse land before the next wave or the next piece
        // eslint-disable-next-line no-await-in-loop
        await pacer.wait(SETTLE_TAIL_MS * speedMultiplier);

        // Phase 3: Recursive cascade - continue the loop to check for new lines
        // The while(true) loop will automatically check for new complete lines

        // Track whether the playfield is empty after gravity settles
        if (gameState.lockedPieces.length === 0) {
            sendForPerfectClear = true;
        }
    }

    // Notify that cascades have completed and camera may need to update
    if (cascadeCount > 0 && callbacks.onCascadeComplete) {
        callbacks.onCascadeComplete(cascadeCount);
    }

    // Perfect Clear Bonus
    // Award bonus points when the entire board is cleared
    if (sendForPerfectClear && depth > 0) {
        let perfectClearBonus = calculateLineClearScore(depth, gameState.level, complexity, true)
            - calculateLineClearScore(depth, gameState.level, complexity, false);
        // Scale the perfect-clear bonus by the same Odyssey combo multiplier for a coherent chain.
        if (gameState.comboMultiplierEnabled && gameState.comboMultiplier > 1) {
            perfectClearBonus = Math.round(perfectClearBonus * gameState.comboMultiplier);
        }
        gameState.score += perfectClearBonus;
        physicsLog(`[Physics] Perfect clear bonus: +${perfectClearBonus} points (depth=${depth})`);
        if (callbacks.onScoreAdd) callbacks.onScoreAdd(perfectClearBonus);
        if (callbacks.onPerfectClear) callbacks.onPerfectClear(depth, perfectClearBonus);
    }

    // --- Finalize ---
    // Note: spawnPiece should be called AFTER isProcessingPhysics is set to false
    // to avoid input blocking issues

    if (linesClearedThisTurn > 0 && callbacks.onGarbageReady) {
        const summary = {
            totalLines: depth,
            depth,
            comboStages: complexity,
            complexity,
            holeMask: holeMaskMatrix.map((mask) => mask.slice()),
            manualColumns: [...manualHoleColumns],
            sendForPerfectClear,
            lockFootprint: comboState.lockFootprint
                ? comboState.lockFootprint.map((cell) => ({ ...cell }))
                : [],
            sourceColor: comboState.sourceColor,
            sourcePiece: comboState.sourcePiece,
            sequence: comboState.sequence,
        };
        callbacks.onGarbageReady(summary);
    }

    if (gameState.comboState) {
        gameState.comboState.depth = depth;
        gameState.comboState.complexity = complexity;
        gameState.comboState.holeMask = holeMaskMatrix.map((mask) => mask.slice());
        gameState.comboState.sendForPerfectClear = sendForPerfectClear;
        gameState.comboState.manualColumns = [...manualHoleColumns];
        gameState.comboState.lockFootprint = [];
        gameState.comboState.sourceColor = null;
    }

    // Odyssey combo-multiplier modifier: maintain the consecutive-clear counter ONCE per lock.
    // processPhysics runs exactly once per lock (the cascade loop above no-ops on a non-clearing
    // lock), so this is the correct single anchor: a clearing lock advances the chain, a
    // non-clearing lock resets it. The multiplier is read by the score-award sites on the NEXT
    // lock, so the first clear of a chain is neutral (x1) and each consecutive clear escalates
    // (x1.5, x2, …). Gated so shared single-player physics is unaffected. (masterplan §2 #3 / C2)
    if (gameState.comboMultiplierEnabled) {
        gameState.comboCount = linesClearedThisTurn > 0 ? (gameState.comboCount || 0) + 1 : 0;
        gameState.comboMultiplier = 1 + (gameState.comboCount * 0.5);
    }

    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);

    // CRITICAL: Invalidate board cache so collision detection uses fresh data
    markBoardDirty(gameState);
}

/**
 * §5.2 cutover path: resolve the entire cascade synchronously up front, then
 * replay the precomputed waves as the flash/gravity animation.
 *
 * The callback schedule, per-wave state-commit points (ADR-0011:
 * commit-per-wave), delay sequence, and sim-clock advancement are identical to
 * processPhysicsLegacy — pinned by physics-callback-schedule.test.js running
 * both implementations against the same goldens, and by the dual-path
 * differential suite. The hole-mask capture machinery (placementGrid /
 * preGravityBoard) does not run here: masks come precomputed from the
 * resolver. Board mutation between waves re-executes the same deterministic
 * helpers the resolver used (cascade-helpers.js), so piece/grid evolution is
 * equal by construction.
 *
 * @param {Object} gameState
 * @param {Object} callbacks - same 19-callback surface as the legacy path
 * @returns {Promise<void>}
 */
/** Build the pure resolver context from live state. */
function createResolverContext(gameState) {
    return {
        boardHeight: gameState.boardGrid?.length,
        level: gameState.level,
        lines: gameState.lines,
        linesUntilNextLevel: gameState.linesUntilNextLevel,
        dropInterval: gameState.dropInterval,
        disableLevelProgression: gameState.disableLevelProgression,
        b2bActive: gameState.b2bActive,
        speedMultiplier: gameState.speedMultiplier,
        lastPlacedPieceX: gameState.lastPlacedPieceX,
        comboState: gameState.comboState,
        comboMultiplierEnabled: gameState.comboMultiplierEnabled,
        comboMultiplier: gameState.comboMultiplier,
        comboCount: gameState.comboCount,
    };
}

// Prepared results are intentionally process-local capabilities. Keeping the
// origin out-of-band means callers may freeze the pure resolver result while
// replay can still reject a stale or cloned result before touching live state.
const preparedPhysicsOrigins = new WeakMap();

function captureResolvedPhysicsOrigin(gameState, context = createResolverContext(gameState)) {
    return JSON.stringify({
        context,
        lineClearCounts: gameState.lineClearCounts,
        lockedPieces: gameState.lockedPieces,
        score: gameState.score,
    });
}

function assertPreparedPhysicsOrigin(gameState, result) {
    const preparation = preparedPhysicsOrigins.get(result);
    if (preparation === undefined) {
        throw new Error('Resolved physics replay requires a result from prepareResolvedPhysics()');
    }
    if (JSON.stringify(result) !== preparation.result) {
        throw new Error('Cannot replay a prepared cascade result after it was mutated');
    }
    if (captureResolvedPhysicsOrigin(gameState) !== preparation.origin) {
        throw new Error('Cannot replay a stale prepared cascade after simulation state changed');
    }
}

/**
 * Compute the resolver-driven cascade future without callbacks or live-state
 * mutation. Replay remains a separate, commit-per-wave operation (ADR-0011).
 */
export function prepareResolvedPhysics(gameState) {
    const context = createResolverContext(gameState);
    const result = resolveCascade(gameState.lockedPieces, context);
    preparedPhysicsOrigins.set(result, {
        origin: captureResolvedPhysicsOrigin(gameState, context),
        result: JSON.stringify(result),
    });
    return result;
}

function finalizeResolvedPhysics(gameState, callbacks, result) {
    if (result.cascadeCount > 0 && callbacks.onCascadeComplete) {
        callbacks.onCascadeComplete(result.cascadeCount);
    }

    if (result.perfectClear) {
        gameState.score += result.perfectClear.bonus;
        if (callbacks.onScoreAdd) callbacks.onScoreAdd(result.perfectClear.bonus);
        if (callbacks.onPerfectClear) {
            callbacks.onPerfectClear(result.perfectClear.depth, result.perfectClear.bonus);
        }
    }

    if (result.linesClearedThisTurn > 0 && callbacks.onGarbageReady) {
        callbacks.onGarbageReady(result.garbageSummary);
    }

    if (gameState.comboState) {
        const after = result.comboStateAfter;
        gameState.comboState.depth = after.depth;
        gameState.comboState.complexity = after.complexity;
        gameState.comboState.holeMask = after.holeMask.map((mask) => mask.slice());
        gameState.comboState.sendForPerfectClear = after.sendForPerfectClear;
        gameState.comboState.manualColumns = [...after.manualColumns];
        gameState.comboState.lockFootprint = [];
        gameState.comboState.sourceColor = null;
    }

    if (gameState.comboMultiplierEnabled) {
        gameState.comboCount = result.comboCountAfter;
        gameState.comboMultiplier = result.comboMultiplierAfter;
    }

    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    markBoardDirty(gameState);
}

/**
 * Canonical-tick fast path for a stable lock. It is intentionally limited to
 * zero-wave results; any full row remains on the certified async replay.
 */
export function tryProcessNoClearSync(gameState, callbacks = {}) {
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    if (detectFullLines(gameState.boardGrid).length > 0) return false;

    // This result is finalized immediately, so avoid provenance serialization
    // reserved for results that cross the prepare/replay seam.
    const result = resolveCascade(gameState.lockedPieces, createResolverContext(gameState));
    if (result.waves.length > 0) return false;
    finalizeResolvedPhysics(gameState, callbacks, result);
    return true;
}

/** Replay a prepared result with the certified callback and delay schedule. */
export async function processPhysicsResolved(
    gameState,
    callbacks,
    result = prepareResolvedPhysics(gameState),
) {
    assertPreparedPhysicsOrigin(gameState, result);

    // Shared with the legacy path: one animation timeline for every wave.
    const pacer = createAnimationPacer(gameState);

    for (const wave of result.waves) {
        // One live array per wave, threaded through flash + clear exactly like
        // the legacy loop's `fullLines` (triggerFlash consumers get the same
        // reference the flash stages iterate).
        const fullLines = wave.fullLines.slice();

        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);

        if (gameState.lineClearCounts) {
            const count = fullLines.length;
            gameState.lineClearCounts[count] = (gameState.lineClearCounts[count] || 0) + 1;
        }

        if (wave.cascadeCount >= 2 && callbacks.triggerCombo) {
            callbacks.triggerCombo(wave.cascadeCount);
        }
        if (wave.cascadeCount >= 2 && callbacks.triggerCascadeWave) {
            callbacks.triggerCascadeWave(wave.cascadeCount);
        }

        // --- Per-wave state commit (ADR-0011) — legacy timeline point ---
        const oldLevel = gameState.level;
        gameState.lines += fullLines.length;
        gameState.linesUntilNextLevel -= fullLines.length;
        if (wave.leveledTo !== null) {
            gameState.level = wave.leveledTo;
            gameState.linesUntilNextLevel += 15;
            gameState.dropInterval = LEVEL_SPEEDS[Math.min(gameState.level - 1, LEVEL_SPEEDS.length - 1)];
            if (gameState.speedMultiplier) {
                gameState.dropInterval /= gameState.speedMultiplier;
            }
            if (callbacks.playLevelUp) callbacks.playLevelUp();
            if (callbacks.onLevelUp) callbacks.onLevelUp(gameState.level);
        } else if (gameState.linesUntilNextLevel <= 0) {
            // Counter reset when level progression is disabled.
            gameState.linesUntilNextLevel += 15;
        }
        if (oldLevel !== gameState.level && callbacks.updateBackground) {
            callbacks.updateBackground(gameState.level);
        }

        gameState.score += wave.points;
        if (callbacks.playLineClear) callbacks.playLineClear();
        if (callbacks.onScoreAdd) callbacks.onScoreAdd(wave.points);
        if (callbacks.onLineClear) {
            callbacks.onLineClear(
                fullLines.length,
                wave.holeColumns.slice(),
                wave.holeMasks.map((mask) => mask.slice()),
                fullLines.slice(),
                wave.cascadeCount,
            );
        }

        if (wave.tSpin && callbacks.onTSpin) {
            callbacks.onTSpin(fullLines.length);
        }
        const isDifficultClear = fullLines.length >= 4 || wave.tSpin;
        if (isDifficultClear) {
            if (wave.b2bFired && callbacks.onB2B) {
                callbacks.onB2B(true);
            }
            gameState.b2bActive = true;
        } else if (wave.cascadeCount === 1) {
            gameState.b2bActive = false;
        }

        if (callbacks.onLineClearImpact) callbacks.onLineClearImpact(fullLines.length, wave.cascadeCount);
        if (callbacks.triggerFlash) callbacks.triggerFlash(fullLines);
        if (callbacks.triggerBackgroundPulse) callbacks.triggerBackgroundPulse(fullLines.length);

        // --- Flash: same shared schedule the legacy path runs ---
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        const markedBoard = cloneBoardGrid(gameState.boardGrid);
        // eslint-disable-next-line no-await-in-loop
        await holdClearedRows(markedBoard, wave.speedMultiplierClass, callbacks, pacer);

        // --- Clear + split + settle (same deterministic helpers) ---
        gameState.lockedPieces = removeClearedLines(gameState.lockedPieces, fullLines);
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        gameState.lockedPieces = findConnectedComponents(gameState.boardGrid);
        // eslint-disable-next-line no-await-in-loop
        await settleLead(gameState, wave.speedMultiplierClass, callbacks, pacer);
        // eslint-disable-next-line no-await-in-loop
        await applyGravity(gameState, callbacks.draw, null, callbacks, pacer);
        // eslint-disable-next-line no-await-in-loop
        await pacer.wait(SETTLE_TAIL_MS * wave.speedMultiplierClass);
    }

    finalizeResolvedPhysics(gameState, callbacks, result);
}

/**
 * The live entry point every mode calls. Dispatches to the §5.2 resolver
 * replay behind the cascadeV2 flag (registry: src/core/flags.js); legacy is
 * the rollback lever until the §5.10 soak clears, then both flag and legacy
 * path are deleted together.
 */
export async function processPhysics(gameState, callbacks) {
    if (readFlag('cascadeV2', false)) {
        return processPhysicsResolved(gameState, callbacks);
    }
    return processPhysicsLegacy(gameState, callbacks);
}
