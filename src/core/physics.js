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
import { calculateQuadraLineScore } from './scoring.js';
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

function waitForAnimationFrame(durationMs) {
    const raf = typeof window !== 'undefined' ? window.requestAnimationFrame : null;
    const perfNow = typeof performance !== 'undefined' && performance?.now ? () => performance.now() : () => Date.now();

    if (!raf) {
        return new Promise((resolve) => setTimeout(resolve, durationMs));
    }

    return new Promise((resolve) => {
        const start = perfNow();
        const tick = (now) => {
            const elapsed = (typeof now === 'number' ? now : perfNow()) - start;
            if (elapsed >= durationMs) {
                resolve();
            } else {
                raf(tick);
            }
        };
        raf(tick);
    });
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

async function waitForPhysicsDelay(gameState, durationMs) {
    advanceReplaySimulationClock(gameState, durationMs);

    if (!gameState?.isSeeking) {
        await waitForAnimationFrame(durationMs);
    }
}

/* moved to cascade-helpers.js: isPartOfPiece */

/* moved to cascade-helpers.js: findConnectedComponents */

/**
 * Applies gravity to blocks after line clears, making them fall independently
 * Uses smooth animation with variable speed based on fall distance
 * PERFORMANCE OPTIMIZED: Uses incremental grid updates instead of full rebuilds
 * @param {Array<Object>} lockedPieces - Array of locked pieces (modified in place)
 * @param {Function} drawCallback - Function to call for visual updates
 * @param {Array<Array<boolean>>} movedArray - 2D array to track which cells moved (optional)
 * @returns {Promise<void>} Resolves when all blocks have settled
 */
export async function applyGravity(
    gameState,
    drawCallback,
    movedArray = null,
    callbacks = {},
) {
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

    // Fixed gravity delay - same speed for all game modes
    // This ensures consistent, snappy cascade feel everywhere
    const gravityDelay = 16; // ms - fixed delay for consistent speed

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
                if (movedArray) {
                    piece.shape.forEach((row, localY) => {
                        row.forEach((cell, localX) => {
                            if (cell > 0) {
                                const boardX = piece.x + localX;
                                const boardY = piece.y + localY + 1; // New position after fall
                                if (boardY < movedArray.length && boardX < movedArray[0].length) {
                                    movedArray[boardY][boardX] = true;
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

            // Use requestAnimationFrame-based timing for smooth, consistent gravity
            if (!gameState.isSeeking) {
                const startTime = performance.now();
                await waitForPhysicsDelay(gameState, gravityDelay);
                const actualDelay = performance.now() - startTime;
                physicsLog(`[Gravity] Step delay: expected ${gravityDelay}ms, actual ${actualDelay.toFixed(1)}ms`);
            } else {
                await waitForPhysicsDelay(gameState, gravityDelay);
            }
        }
    }

    // PERFORMANCE: Grid is already up-to-date from incremental updates
    // No need for final rebuild!
}

/* moved to cascade-helpers.js: detectFullLines */

/**
 * Calculate garbage hole columns for cascade clears (Quadra-authentic fallback)
 *
 * QUADRA METHOD - Use the moved array:
 * Quadra tracks which cells moved (fell down) after line clears. The hole pattern
 * for garbage is determined by scanning the moved array for each cleared row.
 * A column gets a hole if moved[row][col] is true for that cleared row.
 *
 * In Serenity Blocks we prefer the pre/post board delta for cascades, but this
 * helper mirrors Quadra's legacy logic and acts as a deterministic fallback.
 *
 * @param {Array<Array<boolean>>} movedArray - 2D array tracking which cells moved
 * @param {Array<number>} fullLines - Y coordinates of lines being cleared
 * @returns {Array<number>} Array of column indices for garbage holes
 */
export function calculateCascadeHoleColumns(movedArray, fullLines) {
    if (!movedArray || fullLines.length === 0) {
        return [Math.floor(COLS / 2)];
    }

    const highestClearedLine = Math.min(...fullLines);
    const lowestClearedLine = Math.max(...fullLines);

    physicsLog('[calculateCascadeHoleColumns] ========================================');
    physicsLog(
        `[calculateCascadeHoleColumns] QUADRA METHOD: Analyzing cleared lines [${fullLines.join(', ')}]`,
    );

    // Scan the moved array to find which columns had blocks that moved
    // We'll aggregate across all cleared lines to get the hole pattern
    const movedColumns = new Set();

    fullLines.forEach((y) => {
        if (movedArray[y]) {
            for (let x = 0; x < COLS; x++) {
                if (movedArray[y][x]) {
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
        if (movedArray[y]) {
            const viz = Array.from({ length: COLS }, (_, x) => (movedArray[y][x] ? 'X' : '.')).join(
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
 * Returns both the per-row masks (mirroring Quadra's hole_pos buffer) and the merged
 * column set that older callbacks expect.
 *
 * @param {Array<number>} fullLines - Y coordinates of lines being cleared
 * @param {Object} options
 * @param {number} options.cascadeCount - Current cascade index (1 = manual clear)
 * @param {Array<Array<boolean>>} options.movedArray - Movement tracking array
 * @param {Array<Array<boolean>>} options.preGravityBoard - Snapshot before gravity (boolean)
 * @param {Array<Array<Object|null>>} options.currentBoard - Board prior to clearing (object/null)
 * @param {Array<number>} options.manualHoleColumns - Fallback manual hole columns
 * @returns {{rowMasks: Array<Array<number>>, mergedColumns: Array<number>}}
 */
function buildHoleMaskRows(
    fullLines,
    {
        cascadeCount, movedArray, preGravityBoard, currentBoard, manualHoleColumns,
    },
) {
    const fallback = manualHoleColumns && manualHoleColumns.length > 0
        ? manualHoleColumns
        : [Math.floor(COLS / 2)];

    const rowMasks = [];

    fullLines.forEach((y) => {
        let columns = [];

        if (cascadeCount === 1) {
            if (movedArray && movedArray[y]) {
                for (let x = 0; x < COLS; x++) {
                    if (movedArray[y][x]) {
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

            if (columns.length === 0 && movedArray && movedArray[y]) {
                for (let x = 0; x < COLS; x++) {
                    if (movedArray[y][x]) {
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
 * @param {Array<Array<boolean>>} movedArray - Movement tracking array to clear
 */
function resetMovedArray(movedArray) {
    if (!movedArray) return;
    for (let y = 0; y < movedArray.length; y++) {
        movedArray[y].fill(false);
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
 * Main physics processing loop - QUADRA-ACCURATE IMPLEMENTATION
 *
 * CRITICAL: This implements Quadra's exact hole position tracking:
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
    let sendForClean = false;

    // QUADRA CRITICAL: moved[row][col] tracks piece placement positions
    // Initial state: mark where the piece was just placed
    // FIX: Use actual board length for tall boards (100+ rows)
    const boardHeight = gameState.boardGrid?.length || (ROWS + HIDDEN_ROWS);
    const movedArray = Array.from({ length: boardHeight }, () => Array(COLS).fill(false));

    // Step 1: Mark initial piece placement (from lockFootprint)
    if (comboState.lockFootprint && comboState.lockFootprint.length > 0) {
        comboState.lockFootprint.forEach(({ x, y }) => {
            // Floor coordinates to ensure integer indexing
            const floorY = Math.floor(y);
            const floorX = Math.floor(x);
            if (floorY >= 0 && floorY < movedArray.length && floorX >= 0 && floorX < COLS) {
                movedArray[floorY][floorX] = true;
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

        // QUADRA CRITICAL: Store moved[][] state for each cleared line
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
                if (movedArray[y] && movedArray[y][x]) {
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

            if (movedArray[y]) {
                for (let x = 0; x < COLS; x++) {
                    if (movedArray[y][x]) {
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
                    fallbackColumns = calculateCascadeHoleColumns(movedArray, [y]);
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
            gameState.linesUntilNextLevel += 15; // Quadra: 15 lines per level
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

        // Quadra-style scoring: uses depth (lines), level, complexity (cascades), and perfect clear
        // Perfect clear is detected later after all cascades complete, so we pass false here
        // and add the perfect clear bonus at the end if the board is empty
        let points = calculateQuadraLineScore(fullLines.length, gameState.level, cascadeCount, false);
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

        // QUADRA CRITICAL: Clear moved[][] AFTER reading hole positions
        // This prepares it to track which cells fall during gravity
        physicsLog('[Physics] Clearing moved[][] array for gravity tracking');
        resetMovedArray(movedArray);

        // --- Enhanced Visual Feedback with Smooth Fade Animation ---
        // Multi-stage flash effect for smoother, faster transition
        // Timing gets progressively faster for cascades to maintain momentum
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        const markedBoard = cloneBoardGrid(gameState.boardGrid);

        // Progressive speed multiplier: Faster for responsive cascades
        // Cascade 1: 1.0x (70ms total) - Quick but visible
        // Cascade 2-4: 0.8x (56ms) - Faster for cascades
        // Cascade 5-9: 0.6x (42ms) - Quick cascade speed
        // Cascade 10+: 0.5x (35ms) - Very fast for mega cascades
        const speedMultiplier = cascadeCount === 1 ? 1.0
            : cascadeCount <= 4 ? 0.8
                : cascadeCount <= 9 ? 0.6 : 0.5;

        // Stage 1: Keep original colors, full opacity - quick flash
        fullLines.forEach((y) => {
            for (let x = 0; x < COLS; x++) {
                if (markedBoard[y][x]) {
                    markedBoard[y][x].alpha = 1.0;
                }
            }
        });
        if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
        if (callbacks.draw) callbacks.draw();
        await waitForPhysicsDelay(gameState, 30 * speedMultiplier);

        // Stage 2: Keep original colors, slightly dimmed - smooth transition
        fullLines.forEach((y) => {
            for (let x = 0; x < COLS; x++) {
                if (markedBoard[y][x]) {
                    markedBoard[y][x].alpha = 0.6;
                }
            }
        });
        if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
        if (callbacks.draw) callbacks.draw();
        await waitForPhysicsDelay(gameState, 20 * speedMultiplier);

        // Stage 3: Keep original colors, fade to transparent - smooth final fade
        fullLines.forEach((y) => {
            for (let x = 0; x < COLS; x++) {
                if (markedBoard[y][x]) {
                    markedBoard[y][x].alpha = 0.2;
                }
            }
        });
        if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
        if (callbacks.draw) callbacks.draw();
        await waitForPhysicsDelay(gameState, 20 * speedMultiplier);

        // --- Remove cleared lines from pieces ---
        gameState.lockedPieces = removeClearedLines(gameState.lockedPieces, fullLines);

        // Split pieces into individual blocks for independent gravity
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        gameState.lockedPieces = findConnectedComponents(gameState.boardGrid);

        // Snapshot board state before gravity so the next cascade can compare deltas
        preGravityBoard = cloneBoardGrid(gameState.boardGrid).map((row) => row.map((cell) => cell !== null));

        // Phase 2: Apply gravity to individual blocks and track movement
        await applyGravity(gameState, callbacks.draw, movedArray, callbacks);

        // Phase 3: Recursive cascade - continue the loop to check for new lines
        // The while(true) loop will automatically check for new complete lines

        // Track whether the playfield is empty after gravity settles
        if (gameState.lockedPieces.length === 0) {
            sendForClean = true;
        }
    }

    // Notify that cascades have completed and camera may need to update
    if (cascadeCount > 0 && callbacks.onCascadeComplete) {
        callbacks.onCascadeComplete(cascadeCount);
    }

    // Quadra-style Perfect Clear Bonus
    // Award bonus points when the entire board is cleared
    if (sendForClean && depth > 0) {
        let perfectClearBonus = calculateQuadraLineScore(depth, gameState.level, complexity, true)
            - calculateQuadraLineScore(depth, gameState.level, complexity, false);
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
            sendForClean,
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
        gameState.comboState.sendForClean = sendForClean;
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
 * differential suite. The hole-mask capture machinery (movedArray /
 * preGravityBoard) does not run here: masks come precomputed from the
 * resolver. Board mutation between waves re-executes the same deterministic
 * helpers the resolver used (cascade-helpers.js), so piece/grid evolution is
 * equal by construction.
 *
 * @param {Object} gameState
 * @param {Object} callbacks - same 19-callback surface as the legacy path
 * @returns {Promise<void>}
 */
export async function processPhysicsResolved(gameState, callbacks) {
    const result = resolveCascade(gameState.lockedPieces, {
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
    });

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

        // --- Flash stages: verbatim legacy animation (30/20/20ms × class) ---
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        const markedBoard = cloneBoardGrid(gameState.boardGrid);
        const flashStages = [[1.0, 30], [0.6, 20], [0.2, 20]];
        for (const [alpha, delay] of flashStages) {
            fullLines.forEach((y) => {
                for (let x = 0; x < COLS; x++) {
                    if (markedBoard[y][x]) {
                        markedBoard[y][x].alpha = alpha;
                    }
                }
            });
            if (callbacks.updateBoard) callbacks.updateBoard(markedBoard);
            if (callbacks.draw) callbacks.draw();
            // eslint-disable-next-line no-await-in-loop
            await waitForPhysicsDelay(gameState, delay * wave.speedMultiplierClass);
        }

        // --- Clear + split + settle (same deterministic helpers) ---
        gameState.lockedPieces = removeClearedLines(gameState.lockedPieces, fullLines);
        rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
        gameState.lockedPieces = findConnectedComponents(gameState.boardGrid);
        // eslint-disable-next-line no-await-in-loop
        await applyGravity(gameState, callbacks.draw, null, callbacks);
    }

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
        gameState.comboState.sendForClean = after.sendForClean;
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
